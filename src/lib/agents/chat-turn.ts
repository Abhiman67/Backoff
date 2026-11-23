import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { chatAttachmentIds } from "@/lib/chat-attachments";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http-error";
import { streamAi } from "@/lib/ai";
import { DEFAULT_CONVERSATION_TITLE, titleFromFirstMessage } from "@/lib/conversation-title";
import { REPLY_SOURCES_ROLE, replySourceRecordId } from "@/lib/reply-sources";
import { assignmentQuestionPrefix, readThreadData, studyPlanApprovalSchema } from "@/lib/study-coach-thread";
import { buildChatInput, findChatAssignment, saveStudyPlan } from "./chat-context";

const reference = {
  userId: z.string(),
  conversationId: z.string(),
};
const payloadSchema = z.discriminatedUnion("kind", [
  z.object({ ...reference, kind: z.literal("chat"), messageId: z.string(), assignmentId: z.string().optional(), attachmentIds: chatAttachmentIds.optional() }),
  z.object({ ...reference, kind: z.literal("study_plan"), assignmentId: z.string() }),
]);

type Request =
  | { kind: "chat"; message: string; assignmentId?: string; attachmentIds?: string[] }
  | { kind: "study_plan"; assignmentId: string };

const prefix = (conversationId: string) => `chat:${conversationId}:`;
const activeStatuses = ["queued", "running", "retrying"];

export function chatTurnFilter(userId: string, conversationId: string) {
  return { userId, type: "agent.chat", idempotencyKey: { startsWith: prefix(conversationId) } };
}

export async function getLatestChatTurn(userId: string, conversationId: string) {
  return db.jobRecord.findFirst({
    where: chatTurnFilter(userId, conversationId),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

export function chatTurnSnapshot(record: { idempotencyKey: string; status: string } | null) {
  return record && { id: record.idempotencyKey.slice(-36), status: record.status };
}

export async function queueChatTurn({ userId, conversationId, turnId, request }: {
  userId: string;
  conversationId: string;
  turnId: string;
  request: Request | { kind: "retry" };
}) {
  const key = prefix(conversationId) + turnId;
  return db.$transaction(async (tx) => {
    // Serialize submissions to the same thread before inspecting queued work.
    const locked = await tx.conversation.updateMany({
      where: { id: conversationId, userId },
      data: { updatedAt: new Date() },
    });
    if (!locked.count) throw new HttpError("NOT_FOUND", 404, "Conversation not found");

    const current = await tx.jobRecord.findUnique({ where: { idempotencyKey: key } });
    if (current && (request.kind !== "retry" || current.status !== "dead_letter")) return current;

    const active = await tx.jobRecord.findFirst({
      where: { ...chatTurnFilter(userId, conversationId), status: { in: activeStatuses } },
      select: { id: true },
    });
    if (active) throw new HttpError("CHAT_BUSY", 409, "This conversation already has a reply in progress.");

    if (current) {
      return tx.jobRecord.update({
        where: { id: current.id },
        data: { status: "queued", retries: 0, lastError: null, nextAttemptAt: null, createdAt: new Date(Math.max(Date.now(), current.createdAt.getTime() + 1)) },
      });
    }

    if (request.kind === "retry") throw new HttpError("NOT_FOUND", 404, "Reply not found");
    let payload: z.infer<typeof payloadSchema>;
    if (request.kind === "study_plan") {
      payload = { kind: "study_plan", userId, conversationId, assignmentId: request.assignmentId };
    } else {
      const messageId = (request.assignmentId ? assignmentQuestionPrefix(request.assignmentId) : "chat-user-") + turnId + "-" + conversationId;
      await tx.message.create({ data: { id: messageId, conversationId, role: "user", content: request.message } });
      await tx.conversation.updateMany({
        where: { id: conversationId, title: DEFAULT_CONVERSATION_TITLE },
        data: { title: titleFromFirstMessage(request.message) },
      });
      payload = { kind: "chat", userId, conversationId, messageId, assignmentId: request.assignmentId, attachmentIds: request.attachmentIds };
    }
    return tx.jobRecord.create({
      data: { userId, type: "agent.chat", idempotencyKey: key, payload: JSON.stringify(payload), maxRetries: 0 },
    });
  });
}

export async function executeChatTurn(jobId: string, value: unknown) {
  const { userId, conversationId, assignmentId, ...turn } = payloadSchema.parse(value);
  const job = await db.jobRecord.findFirst({ where: { id: jobId, userId, status: "running" }, select: { updatedAt: true } });
  if (!job) return;
  const conv = await db.conversation.findFirst({ where: { id: conversationId, userId }, include: { agent: true } });
  if (!conv) return; // The conversation was deleted before the reply.
  const assignment = await findChatAssignment(userId, assignmentId);
  if (assignmentId && (!assignment || conv.agent.template !== "study-coach")) throw new Error("Classroom assignment unavailable");
  if (turn.kind === "study_plan") {
    if (!assignment || ["completed", "cancelled"].includes(assignment.status)) throw new Error("Classroom assignment closed");
    const existing = await db.approval.findFirst({ where: { id: `study-plan-${assignment.id}`, ownerId: userId } });
    const previous = existing && readThreadData(studyPlanApprovalSchema, existing.payload);
    const input = previous ? null : await buildChatInput({
      conv, assignment,
      message: 'Return a JSON object with one "sessions" array of exactly three study task titles. Include a time estimate in each title and keep it under 200 characters. Use the assignment and real deadlines in context. Do not add prose or markdown.',
    });
    let proposal = "";
    if (input) {
      for await (const event of streamAi({
        ...input,
        output: { kind: "study_plan", assignmentTitle: assignment.title },
        system: input.system + "\nFor this structured draft, output only the requested JSON object. Omit the response footer.",
      })) {
        if (event.type === "error") throw new Error(event.message);
        if (event.type === "message_delta") proposal += event.text;
      }
    }
    const sessions = previous?.sessions ?? readThreadData(
      z.object({ sessions: z.array(z.string().trim().min(1).max(200)).length(3) }),
      proposal.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""),
    )?.sessions;
    if (!sessions) throw new Error("Study plan generation failed");
    await db.$transaction(async (tx) => {
      if (!(await finishChatTurn(tx, { jobId, updatedAt: job.updatedAt, conversationId, userId }))) return;
      await saveStudyPlan(tx, { id: conversationId, userId, agentId: conv.agentId, assignment, sessions });
      if (input) await tx.usageEvent.create({ data: { ownerId: userId, type: "message" } });
    });
    return;
  }

  const prompt = await db.message.findFirstOrThrow({ where: { id: turn.messageId, conversationId, role: "user" } });
  const input = await buildChatInput({ conv, assignment, message: prompt.content, before: prompt, attachmentIds: turn.attachmentIds });
  let reply = "";
  for await (const event of streamAi(input)) {
    if (event.type === "error") throw new Error(event.message);
    if (event.type === "message_delta") reply += event.text;
  }
  if (!reply.trim()) throw new Error("AI returned an empty reply");
  await db.$transaction(async (tx) => {
    if (!(await finishChatTurn(tx, { jobId, updatedAt: job.updatedAt, conversationId, userId }))) return;
    const id = `chat-assistant-${jobId}`;
    await tx.message.create({ data: { id, conversationId, role: "assistant", content: reply } });
    if (input.contextFiles?.length) {
      await tx.message.create({ data: {
        id: replySourceRecordId(id), conversationId, role: REPLY_SOURCES_ROLE,
        content: JSON.stringify(input.contextFiles.map(({ id, name }) => ({ id, label: name }))),
      } });
    }
    await tx.usageEvent.create({ data: { ownerId: userId, type: "message" } });
  });
}

async function finishChatTurn(tx: Prisma.TransactionClient, { jobId, updatedAt, conversationId, userId }: {
  jobId: string;
  updatedAt: Date;
  conversationId: string;
  userId: string;
}) {
  const thread = await tx.conversation.updateMany({
    where: { id: conversationId, userId },
    data: { updatedAt: new Date() },
  });
  if (!thread.count) return false;
  const result = await tx.jobRecord.updateMany({
    where: { id: jobId, status: "running", updatedAt },
    data: { status: "completed" },
  });
  return result.count > 0;
}
