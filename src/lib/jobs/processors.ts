import { dispatchChatTurn, registerHandler } from "./queue";
import { getJobMode } from "./redis";
import { db } from "@/lib/db";
import { chunkText } from "@/lib/chunking";
import { embedTexts } from "@/lib/embeddings";
import { extractDocxText, extractPdfText } from "@/lib/parser";
import { objectStorage } from "@/lib/storage";
import { logError, logInfo } from "@/lib/observability/logger";

function failReason(code: string) {
  return code;
}

registerHandler("usage.aggregate", async () => {
  await db.usageEvent.count();
});

// file.extract: read bytes from object storage, extract text, then chain chunk.
registerHandler("file.extract", async (job) => {
  const { fileId, ownerId } = job.payload as { fileId: string; ownerId: string };
  const file = await db.file.findFirst({ where: { id: fileId, ownerId } });
  if (!file || file.status === "deleted") return;
  try {
    await db.file.update({ where: { id: fileId }, data: { status: "processing" } });
    let bytes: Uint8Array | null = null;
    if (file.storageKey) bytes = await objectStorage.get(file.storageKey);
    // Fallback to inline textContent for rows created before the storage path.
    let text = file.textContent || "";
    if (bytes && bytes.length > 0) {
      const name = file.name.toLowerCase();
      if (name.endsWith(".txt") || name.endsWith(".md")) {
        text = new TextDecoder().decode(bytes).slice(0, 20000);
      } else if (name.endsWith(".docx")) {
        text = (await extractDocxText(bytes.buffer as ArrayBuffer)).slice(0, 20000);
      } else if (name.endsWith(".pdf")) {
        text = (await extractPdfText(bytes.buffer as ArrayBuffer)).slice(0, 20000);
      }
    }
    job.signal?.throwIfAborted();
    if (!text.trim()) {
      await db.file.update({ where: { id: fileId }, data: { status: "failed", failureReason: failReason("EMPTY_TEXT") } });
      return;
    }
    await db.file.update({ where: { id: fileId }, data: { textContent: text } });
    const { enqueue } = await import("./queue");
    // A reprocess must also rerun chunking and embedding. Key downstream jobs
    // to this extraction attempt so completed jobs from an earlier attempt do
    // not leave the file stuck in `processing`.
    await enqueue("file.chunk", { fileId, ownerId }, { idempotencyKey: `file.chunk:${fileId}:${job.idempotencyKey}` });
  } catch (err) {
    logError("file.extract.failed", { fileId });
    await db.file.update({ where: { id: fileId }, data: { status: "failed", failureReason: failReason("EXTRACT_FAILED") } });
    throw err;
  }
});

// file.chunk: split text into bounded chunks, replace FileChunk rows, chain embed.
registerHandler("file.chunk", async (job) => {
  const { fileId, ownerId } = job.payload as { fileId: string; ownerId: string };
  const file = await db.file.findFirst({ where: { id: fileId, ownerId } });
  if (!file || file.status === "deleted") return;
  const chunks = chunkText(file.textContent || "", 800, 120).slice(0, 50);
  if (!chunks.length) {
    await db.file.update({ where: { id: fileId }, data: { status: "failed", failureReason: failReason("EMPTY_TEXT") } });
    return;
  }
  job.signal?.throwIfAborted();
  await db.fileChunk.deleteMany({ where: { fileId } });
  for (const c of chunks) {
    await db.fileChunk.create({ data: { fileId, ownerId, index: c.index, content: c.content.slice(0, 4000) } });
  }
  logInfo("file.chunked", { fileId, chunks: chunks.length });
  const { enqueue } = await import("./queue");
  await enqueue("file.embed", { fileId, ownerId }, { idempotencyKey: `file.embed:${fileId}:${job.idempotencyKey}` });
});

// Keep lexical search available without an API key; persist real embeddings when configured.
registerHandler("file.embed", async (job) => {
  const { fileId, ownerId } = job.payload as { fileId: string; ownerId: string };
  const chunks = await db.fileChunk.findMany({ where: { fileId, ownerId }, orderBy: { index: "asc" }, take: 50 });
  if (!chunks.length) {
    await db.file.update({ where: { id: fileId }, data: { status: "failed", failureReason: failReason("NO_CHUNKS") } });
    return;
  }
  let embeddings: number[][] | null = null;
  try {
    embeddings = await embedTexts(chunks.map((chunk) => chunk.content));
  } catch {
    logError("file.embed.failed", { fileId });
  }
  job.signal?.throwIfAborted();
  if (embeddings) {
    await db.$transaction(chunks.map((chunk, index) => db.fileChunk.update({
      where: { id: chunk.id }, data: { embedding: embeddings[index] },
    })));
  }
  await db.file.update({ where: { id: fileId }, data: { status: "ready", failureReason: null } });
  logInfo("file.ready", { fileId, chunks: chunks.length });
});

registerHandler("classroom.attachment", async ({ payload }) => {
  if (typeof payload.attachmentId !== "string") throw new Error("Invalid Classroom attachment job");
  const { processClassroomAttachment } = await import("@/lib/integrations/classroom-import");
  await processClassroomAttachment(payload.attachmentId);
});

registerHandler("agent.chat", async (job) => {
  const { executeChatTurn } = await import("@/lib/agents/chat-turn");
  await executeChatTurn(job.id, job.payload);
});

registerHandler("agent.run", async (job) => {
  const { executeRun } = await import("@/lib/agents/orchestrator");
  const { runId, ownerId } = job.payload as { runId: string; ownerId: string };
  if (!runId || !ownerId) throw new Error("Invalid agent.run payload");
  await executeRun(runId, ownerId);
});

registerHandler("agent.resume", async (job) => {
  const { resumeRun } = await import("@/lib/agents/orchestrator");
  const { runId, ownerId } = job.payload as { runId: string; ownerId: string };
  await resumeRun(runId, ownerId);
});

registerHandler("agent.retry", async (job) => {
  const { resumeRun } = await import("@/lib/agents/orchestrator");
  const { runId, ownerId } = job.payload as { runId: string; ownerId: string };
  await resumeRun(runId, ownerId);
});

registerHandler("responsibility.tick", async () => {
  if (getJobMode() === "redis") {
    const queued = await db.jobRecord.findMany({
      where: { type: "agent.chat", status: "queued" },
      orderBy: { updatedAt: "asc" }, take: 50,
    });
    for (const turn of queued) {
      await dispatchChatTurn(turn).catch(() => logError("chat.dispatch.failed", { jobId: turn.id }));
    }
  }
  const { tickResponsibilities } = await import("@/lib/responsibilities");
  await tickResponsibilities();
});

export {};
