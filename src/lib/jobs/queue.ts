import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logError, logInfo } from "@/lib/observability/logger";
import { MAX_EXECUTION_MS, backoffMs, type Job, type JobHandler, type JobType } from "./types";
import { getJobMode } from "./redis";

const handlers = new Map<JobType, JobHandler<Record<string, unknown>>>();
const cancelled = new Set<string>();

export function registerHandler(type: JobType, handler: JobHandler<Record<string, unknown>>) {
  handlers.set(type, handler);
}

export function cancelJob(idempotencyKey: string) {
  cancelled.add(idempotencyKey);
}

async function runWithTimeout<T>(type: JobType, fn: () => Promise<T>): Promise<T> {
  const max = MAX_EXECUTION_MS[type] ?? 60_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Job timed out after ${max}ms`)), max);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Runs the registered handler with timeout + cancellation.
 * Shared by inline execution and the Redis worker. Throws on failure
 * so callers record retry/dead-letter state; never swallows errors.
 */
export async function runHandler(job: Job<Record<string, unknown>>): Promise<void> {
  const handler = handlers.get(job.type);
  if (!handler) throw new Error(`No handler for job type ${job.type}`);
  if (cancelled.has(job.idempotencyKey)) throw new Error("Job cancelled");
  await runWithTimeout(job.type, () => handler(job));
}

export async function enqueue<T extends Record<string, unknown>>(
  type: JobType,
  payload: T,
  opts: { idempotencyKey?: string; maxRetries?: number; executeInline?: boolean } = {}
) {
  const key = opts.idempotencyKey ?? `${type}:${JSON.stringify(payload).slice(0, 120)}:${Date.now()}`;
  const serialized = JSON.stringify(payload).slice(0, 8000);
  let deduped = false;
  const record = await db.jobRecord.create({
    data: { type, idempotencyKey: key, payload: serialized, status: "queued", maxRetries: opts.maxRetries ?? 3 },
  }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      deduped = true;
      return db.jobRecord.findUniqueOrThrow({ where: { idempotencyKey: key } });
    }
    throw error;
  });
  if (["running", "retrying", "completed"].includes(record.status)) return { deduped: true, key, status: record.status };
  if (record.status !== "queued") {
    const requeued = await db.jobRecord.updateMany({
      where: { id: record.id, status: record.status, updatedAt: record.updatedAt },
      data: { type, payload: serialized, status: "queued", lastError: null, nextAttemptAt: null },
    });
    if (!requeued.count) return { deduped: true, key, status: "queued" };
  }
  // Redis mode: persist + hand to BullMQ, report honestly as queued.
  // executeInline:false only short-circuits in inline mode (tests).
  if (getJobMode() === "redis") {
    const { getBullQueue, bullOptions, bullJobId } = await import("./bull");
    await getBullQueue().add(type, { recordKey: key }, { ...bullOptions(record.maxRetries), jobId: bullJobId(type, key) });
    logInfo("job.queued", { type, key });
    return { deduped, key, status: "queued" };
  }
  if (opts.executeInline === false) return { deduped, key, status: "queued" };
  const job: Job<T> = { id: record.id, type, payload, idempotencyKey: key, retries: record.retries, maxRetries: record.maxRetries, createdAt: record.createdAt };
  return processJob(job);
}

async function processJob<T extends Record<string, unknown>>(job: Job<T>): Promise<{ deduped: boolean; key: string; status: string }> {
  const claimed = await db.jobRecord.updateMany({ where: { id: job.id, status: "queued" }, data: { status: "running" } });
  if (!claimed.count) {
    const record = await db.jobRecord.findUnique({ where: { id: job.id }, select: { status: true } });
    return { deduped: true, key: job.idempotencyKey, status: record?.status ?? "cancelled" };
  }
  const handler = handlers.get(job.type);
  if (!handler) {
    await db.jobRecord.update({ where: { idempotencyKey: job.idempotencyKey }, data: { status: "dead_letter", lastError: "No handler" } });
    return { deduped: false, key: job.idempotencyKey, status: "dead_letter" };
  }
  const started = Date.now();
  try {
    if (cancelled.has(job.idempotencyKey)) throw new Error("Job cancelled");
    await runWithTimeout(job.type, () => handler(job as Job<Record<string, unknown>>));
    await db.jobRecord.update({ where: { idempotencyKey: job.idempotencyKey }, data: { status: "completed" } });
    logInfo("job.completed", { type: job.type, key: job.idempotencyKey, durationMs: Date.now() - started });
    return { deduped: false, key: job.idempotencyKey, status: "completed" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Job failed";
    const rec = await db.jobRecord.findUnique({ where: { idempotencyKey: job.idempotencyKey } });
    const retries = (rec?.retries ?? job.retries) + 1;
    const max = rec?.maxRetries ?? job.maxRetries;
    if (retries > max || /cancelled/i.test(message)) {
      await db.jobRecord.update({ where: { idempotencyKey: job.idempotencyKey }, data: { status: message.match(/cancel/i) ? "cancelled" : "dead_letter", retries, lastError: message.slice(0, 1000) } });
      logError("job.dead_letter", { type: job.type, key: job.idempotencyKey, error: message });
      return { deduped: false, key: job.idempotencyKey, status: "dead_letter" };
    }
    await db.jobRecord.update({
      where: { idempotencyKey: job.idempotencyKey },
      data: { status: "retrying", retries, lastError: message.slice(0, 1000), nextAttemptAt: new Date(Date.now() + backoffMs(retries)) },
    });
    logError("job.retrying", { type: job.type, key: job.idempotencyKey, retries, error: message });
    throw err;
  }
}

export async function retryJob(idempotencyKey: string) {
  const rec = await db.jobRecord.findUnique({ where: { idempotencyKey } });
  if (!rec) throw new Error("Job not found");
  if (!["dead_letter", "failed", "retrying"].includes(rec.status)) throw new Error(`Cannot retry job in ${rec.status}`);
  const handler = handlers.get(rec.type as JobType);
  if (!handler) throw new Error("No handler");
  await db.jobRecord.update({ where: { idempotencyKey }, data: { status: "queued", lastError: null, nextAttemptAt: null } });
  return processJob({ id: rec.id, type: rec.type as JobType, payload: JSON.parse(rec.payload || "{}"), idempotencyKey, retries: rec.retries, maxRetries: rec.maxRetries, createdAt: rec.createdAt });
}

export function __resetJobsForTests() {
  handlers.clear();
  cancelled.clear();
}

type PersistedChatJob = {
  id: string;
  idempotencyKey: string;
  payload: string;
  status: string;
  retries: number;
  maxRetries: number;
  createdAt: Date;
  updatedAt: Date;
};

export async function dispatchChatTurn(record: PersistedChatJob) {
  if (record.status !== "queued") return;
  if (getJobMode() === "redis") {
    const { getBullQueue, bullOptions } = await import("./bull");
    await getBullQueue().add("agent.chat", { key: record.idempotencyKey, version: record.createdAt.getTime() }, {
      ...bullOptions(record.maxRetries),
      jobId: `agent-chat-${record.id}-${record.createdAt.getTime()}`,
    });
    return;
  }
  await runPersistedChatJob(record);
}

export async function runPersistedChatJob(record: PersistedChatJob, recoverStalled = false) {
  const status = recoverStalled ? "running" : "queued";
  const claimedAt = new Date(Math.max(Date.now(), record.updatedAt.getTime() + 1));
  const claimed = await db.jobRecord.updateMany({
    where: { id: record.id, status, updatedAt: record.updatedAt },
    data: { status: "running", updatedAt: claimedAt },
  });
  if (!claimed.count) return;
  const working = { id: record.id, status: "running", updatedAt: claimedAt };
  try {
    await runHandler({
      id: record.id, type: "agent.chat", idempotencyKey: record.idempotencyKey,
      payload: JSON.parse(record.payload), retries: record.retries,
      maxRetries: record.maxRetries, createdAt: record.createdAt,
    });
    await db.jobRecord.updateMany({ where: working, data: { status: "completed" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chat execution failed";
    await db.jobRecord.updateMany({ where: working, data: { status: "dead_letter", lastError: message.slice(0, 1000) } });
    logError("chat.turn.failed", { jobId: record.id });
  }
}
