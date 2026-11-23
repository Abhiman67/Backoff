import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DEFAULT_CONVERSATION_TITLE, MAX_CONVERSATION_TITLE_LENGTH, titleFromFirstMessage } from "@/lib/conversation-title";
import { REPLY_SOURCES_ROLE, replySourceRecordId, replySourcesSchema } from "@/lib/reply-sources";
import { CLASSROOM_UPDATE_ROLE, assignmentQuestionPrefix, readThreadData, studyCoachThreadId, studyPlanSchema, STUDY_PLAN_ROLE } from "@/lib/study-coach-thread";
import { after, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { streamAi, sseEncode } from "@/lib/ai";
import { trackUsage } from "@/lib/usage";
import { rateLimitDistributed } from "@/lib/rate-limit";
import { getQuota } from "@/lib/quotas";
import { chatAttachmentIds } from "@/lib/chat-attachments";
import { buildChatInput, findChatAssignment, saveStudyPlan } from "@/lib/agents/chat-context";
import { chatTurnFilter, chatTurnSnapshot, getLatestChatTurn, queueChatTurn } from "@/lib/agents/chat-turn";
import { dispatchChatTurn } from "@/lib/jobs/queue";
import { getJobMode } from "@/lib/jobs/redis";
import { logError } from "@/lib/observability/logger";
import "@/lib/jobs/processors";
import { handleApi, HttpError, invalid, notFound } from "@/lib/api";

export const maxDuration = 120;

export const GET = handleApi<{ id: string }>(async (req, { userId }, params) => {
  const { id } = params;
  const url = new URL(req.url);
  if (url.searchParams.get("classroomActivity") === "1") {
    const card = await db.message.findFirst({
      where: { conversationId: id, conversation: { userId }, role: CLASSROOM_UPDATE_ROLE },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    return NextResponse.json({ updatedAt: card?.createdAt ?? null }, { headers: { "Cache-Control": "no-store" } });
  }
  const trackTurn = url.searchParams.get("turn") === "1";
  let turn = trackTurn ? await getLatestChatTurn(userId, id) : null;
  if (turn?.status === "running" && Date.now() - turn.updatedAt.getTime() > 120_000) {
    await db.jobRecord.updateMany({
      where: { id: turn.id, status: "running", updatedAt: turn.updatedAt },
      data: { status: "dead_letter", lastError: "Chat execution interrupted" },
    });
    turn = await getLatestChatTurn(userId, id);
  }
  if (turn?.status === "queued") {
    const queued = turn;
    after(() => dispatchChatTurn(queued).catch(() => logError("chat.dispatch.failed", { jobId: queued.id })));
  }
  const take = Math.min(Math.max(Number(url.searchParams.get("take") || 200), 1), 200);
  const cursor = url.searchParams.get("cursor");
  const latest = !cursor && url.searchParams.get("latest") === "1";
  const direction = latest ? "desc" : "asc";
  const conv = await db.conversation.findFirst({
    where: { id, userId },
    include: {
      messages: { where: { role: { not: REPLY_SOURCES_ROLE } }, orderBy: [{ createdAt: direction }, { id: direction }], take: take + 1, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) },
      agent: {
        select: {
          id: true,
          template: true,
          name: true,
          role: true,
          description: true,
          icon: true,
          category: true,
        },
      },
    },
  });
  if (!conv) throw notFound("Conversation");
  const hasMore = conv.messages.length > take;
  if (hasMore) conv.messages.pop();
  if (latest) conv.messages.reverse();
  const approvalIds = conv.messages.flatMap((message) => {
    const plan = message.role === STUDY_PLAN_ROLE && readThreadData(studyPlanSchema, message.content);
    return plan ? [plan.approvalId] : [];
  });
  const approvals = approvalIds.length
    ? await db.approval.findMany({ where: { ownerId: userId, id: { in: approvalIds } }, select: { id: true, status: true } })
    : [];
  const replyRecords = conv.messages.filter(({ role }) => role === "assistant").map(({ id }) => replySourceRecordId(id));
  const sourceRecords = replyRecords.length ? await db.message.findMany({
    where: { conversationId: id, role: REPLY_SOURCES_ROLE, id: { in: replyRecords } },
    select: { id: true, content: true },
  }) : [];
  const sources = new Map(sourceRecords.map((record) => [record.id, readThreadData(replySourcesSchema, record.content)]));
  const messages = conv.messages.map((message) => ({
    ...message, sources: sources.get(replySourceRecordId(message.id)) ?? undefined,
  }));
  return NextResponse.json({
    conversation: { ...conv, messages }, approvals,
    ...(trackTurn && { turn: chatTurnSnapshot(turn) }),
    nextCursor: hasMore && !latest ? conv.messages.at(-1)?.id ?? null : null,
  }, { headers: { "Cache-Control": "no-store" } });
});

export const PATCH = handleApi<{ id: string }>(async (req, { userId }, params) => {
  const { id } = params;
  const conv = await db.conversation.findFirst({ where: { id, userId } });
  if (!conv) throw notFound("Conversation");
  const parsed = z.object({
    title: z.string().trim().min(1).max(MAX_CONVERSATION_TITLE_LENGTH)
      .refine((title) => title !== DEFAULT_CONVERSATION_TITLE).optional(),
    projectId: z.string().nullable().optional(),
  }).safeParse(await req.json());
  if (!parsed.success) throw invalid("Enter a conversation title of up to 120 characters.");
  const { title, projectId } = parsed.data;
  if (projectId) {
    const p = await db.project.findFirst({ where: { id: projectId, ownerId: userId } });
    if (!p) throw new HttpError("PROJECT_NOT_FOUND", 404, "Project not found");
  }
  const updated = await db.conversation.update({
    where: { id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(projectId !== undefined ? { projectId: projectId || null } : {}),
    },
  });
  return NextResponse.json({ conversation: updated });
});

export const DELETE = handleApi<{ id: string }>(async (_, { userId }, params) => {
  const { id } = params;
  const conv = await db.conversation.findFirst({ where: { id, userId } });
  if (!conv) throw notFound("Conversation");
  if (id === studyCoachThreadId(conv.agentId)) {
    throw new HttpError("SYSTEM_CONVERSATION", 409, "Classroom sync uses this conversation.");
  }
  await db.$transaction(async (tx) => {
    await tx.conversation.delete({ where: { id, userId } });
    await tx.jobRecord.deleteMany({ where: chatTurnFilter(userId, id) });
  });
  return NextResponse.json({ ok: true });
});

export const POST = handleApi<{ id: string }>(async (req, { userId }, params) => {
  const { id } = params;
  if (!(await rateLimitDistributed(`chat:${userId}`, 30))) throw new HttpError("RATE_LIMITED", 429, "Too many messages");
  const quota = await getQuota(userId, "messages");
  if (!quota.allowed) throw new HttpError("QUOTA_EXCEEDED", 402, "Message quota exceeded", false, { quota });
  const conv = await db.conversation.findFirst({ where: { id, userId }, include: { agent: true } });
  if (!conv) throw notFound("Conversation");
  const turnId = z.uuid().optional();
  const parsed = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("study_plan"), assignmentId: z.string().min(1), turnId }),
    z.object({ kind: z.literal("chat"), message: z.string().trim().min(1).max(4000), assignmentId: z.string().optional(), attachmentIds: chatAttachmentIds.optional(), turnId }),
    z.object({ kind: z.literal("retry"), turnId: z.uuid() }),
  ]).safeParse({ kind: "chat", ...await req.json() });
  if (!parsed.success) throw invalid("Invalid chat request");
  const request = parsed.data;
  const assignmentId = request.kind === "retry" ? undefined : request.assignmentId;
  const assignment = await findChatAssignment(userId, assignmentId);
  if (assignmentId && (!assignment || conv.agent.template !== "study-coach")) throw notFound("Classroom assignment");
  if (request.kind === "study_plan" && assignment && ["completed", "cancelled"].includes(assignment.status)) throw invalid("This assignment is closed.");
  const attachmentIds = request.kind === "chat" ? [...new Set(request.attachmentIds)] : [];
  if (attachmentIds.length && await db.file.count({
    where: { ownerId: userId, status: "ready", id: { in: attachmentIds } },
  }) !== attachmentIds.length) throw invalid("An attached file is unavailable. Choose it again.");
  if (request.turnId) {
    const job = await queueChatTurn({ userId, conversationId: id, turnId: request.turnId, request });
    if (getJobMode() === "redis") {
      // The accepted turn is already durable. A later fetch or worker tick can retry dispatch.
      await dispatchChatTurn(job).catch(() => logError("chat.dispatch.failed", { jobId: job.id }));
    } else {
      after(() => dispatchChatTurn(job).catch(() => logError("chat.dispatch.failed", { jobId: job.id })));
    }
    return NextResponse.json({ turn: chatTurnSnapshot(job) }, { status: 202 });
  }

  if (request.kind === "study_plan" && assignment) {
    if (["completed", "cancelled"].includes(assignment.status)) throw invalid("This assignment is closed.");
    const result = await db.$transaction((tx) => saveStudyPlan(tx, { id, userId, agentId: conv.agentId, assignment }));
    return NextResponse.json(result);
  }
  if (request.kind !== "chat") throw invalid("Select a Classroom assignment first");
  const { message } = request;
  const sentAt = new Date();
  const input = await buildChatInput({ conv, message, assignment, attachmentIds });

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      let full = "";
      try {
        for await (const e of streamAi(input)) {
          if (e.type === "error") throw new Error(e.message);
          if (e.type === "done") continue;
          if (e.type === "message_delta") full += e.text;
          if (e.type === "approval_required") {
            const approval = await db.approval.create({
              data: {
                ownerId: userId,
                agentId: conv.agentId,
                title: `Approve: ${message.slice(0, 80)}`,
                description: e.description,
                payload: e.payload || "{}",
              },
            });
            controller.enqueue(enc.encode(sseEncode({ ...e, approvalId: approval.id })));
            continue;
          }
          controller.enqueue(enc.encode(sseEncode(e)));
        }
        if (!full.trim() || req.signal.aborted) throw new Error("Incomplete reply");
        const { saved, conversation } = await db.$transaction(async (tx) => {
          const untitled = await tx.conversation.findFirst({
            where: { id, title: DEFAULT_CONVERSATION_TITLE },
            select: { messages: {
              where: { role: "user" },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              take: 1,
              select: { content: true },
            } },
          });
          if (untitled) {
            await tx.conversation.updateMany({
              where: { id, title: DEFAULT_CONVERSATION_TITLE },
              data: { title: titleFromFirstMessage(untitled.messages[0]?.content ?? message) },
            });
          }
          await tx.message.create({ data: {
            ...(assignment ? { id: `${assignmentQuestionPrefix(assignment.id)}${randomUUID()}` } : {}),
            conversationId: id, role: "user", content: message, createdAt: sentAt,
          } });
          const saved = await tx.message.create({ data: { conversationId: id, role: "assistant", content: full } });
          if (input.contextFiles?.length) {
            await tx.message.create({ data: {
              id: replySourceRecordId(saved.id),
              conversationId: id,
              role: REPLY_SOURCES_ROLE,
              content: JSON.stringify(input.contextFiles.map(({ id, name }) => ({ id, label: name }))),
            } });
          }
          const conversation = await tx.conversation.update({
            where: { id }, data: { updatedAt: new Date() }, select: { title: true, updatedAt: true },
          });
          return { saved, conversation };
        });
        controller.enqueue(enc.encode(sseEncode({
          type: "done", messageId: saved.id,
          conversation: { title: conversation.title, updatedAt: conversation.updatedAt.toISOString() },
        })));
        await trackUsage(userId, "message");
      } catch {
        controller.enqueue(enc.encode(sseEncode({ type: "error", message: "AI failed. Retry." })));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
});
