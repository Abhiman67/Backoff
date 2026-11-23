import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { dispatchChatTurn } from "@/lib/jobs/queue";
import "@/lib/jobs/processors";
import { decideApproval } from "@/lib/approvals-decide";
import { REPLY_SOURCES_ROLE } from "@/lib/reply-sources";
import { CLASSROOM_UPDATE_ROLE, STUDY_PLAN_ROLE, studyCoachThreadId } from "@/lib/study-coach-thread";
import { updateClassroomCoachCard } from "@/lib/classroom-coach-update";
import { getLatestChatTurn, queueChatTurn } from "./chat-turn";

let userId: string;
let agentId: string;
let conversationId: string;
let assignmentId: string;
let fileId: string;
const sessions = ["15 min · Review recursion requirements", "25 min · Trace base cases", "10 min · Check test coverage"];

beforeAll(async () => {
  const user = await db.user.create({ data: { name: "Student", email: `${randomUUID()}@test.local`, passwordHash: "test" } });
  userId = user.id;
  const agent = await db.agent.create({
    data: { ownerId: userId, name: "Study Coach", template: "study-coach", role: "study", description: "coach", category: "Academic", systemPrompt: "Study Coach" },
  });
  agentId = agent.id;
  conversationId = studyCoachThreadId(agent.id);
  await db.conversation.create({ data: { id: conversationId, agentId, userId } });
  const file = await db.file.create({
    data: { ownerId: userId, name: "Recursion notes.txt", mimeType: "text/plain", size: 30, textContent: "Recursion must reach a base case." },
  });
  fileId = file.id;
  const assignment = await db.task.create({
    data: { ownerId: userId, title: "Recursion exercise", externalProvider: "classroom", externalId: "course:homework", assignmentSourceIds: [fileId], dueDate: new Date("2090-01-09T08:00:00Z") },
  });
  assignmentId = assignment.id;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function geminiReply(reply: string, status = 200) {
  vi.stubEnv("CHAT_AI_PROVIDER", "gemini");
  vi.stubEnv("GEMINI_API_KEY", "test-provider-key");
  vi.stubEnv("JOB_EXECUTION_MODE", "inline");
  const body = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: reply }] } }] })}\n\n`;
  const provider = vi.fn(async (_url: string, _request: RequestInit) => new Response(body, { status }));
  vi.stubGlobal("fetch", provider);
  return provider;
}

describe("durable agent chat", () => {
  it("saves the message before dispatch and reopens with one grounded reply", async () => {
    const provider = geminiReply("Start by tracing the base case.");
    const change = { assignmentId, title: "Recursion exercise", status: "pending", dueDate: "2090-01-09T08:00:00.000Z" } as const;
    await updateClassroomCoachCard(conversationId, change);
    await updateClassroomCoachCard(conversationId, change);
    expect(await db.message.count({ where: { conversationId, role: CLASSROOM_UPDATE_ROLE } })).toBe(1);

    const submitted = { userId, conversationId, turnId: randomUUID(), request: { kind: "chat", message: "Explain recursion", assignmentId } } as const;
    const turn = await queueChatTurn(submitted);
    expect(await queueChatTurn(submitted)).toMatchObject({ id: turn.id });
    expect(await getLatestChatTurn(userId, conversationId)).toMatchObject({ status: "queued" });
    expect(await db.message.count({ where: { conversationId, role: "user" } })).toBe(1);
    expect(await db.message.count({ where: { conversationId, role: "assistant" } })).toBe(0);

    await Promise.all([dispatchChatTurn(turn), dispatchChatTurn(turn)]);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0]?.[1].body).toContain("Recursion must reach a base case.");
    expect(await getLatestChatTurn(userId, conversationId)).toMatchObject({ status: "completed" });
    expect(await db.message.findMany({ where: { conversationId, role: "assistant" } }))
      .toMatchObject([{ content: "Start by tracing the base case." }]);
    const sources = await db.message.findFirstOrThrow({ where: { conversationId, role: REPLY_SOURCES_ROLE } });
    expect(JSON.parse(sources.content)).toEqual([{ id: fileId, label: "Recursion notes.txt" }]);
  });

  it("retries a provider failure using the existing prompt", async () => {
    geminiReply("", 503);
    const submitted = { userId, conversationId, turnId: randomUUID(), request: { kind: "chat", message: "Show a second hint", assignmentId } } as const;
    await dispatchChatTurn(await queueChatTurn(submitted));
    expect(await getLatestChatTurn(userId, conversationId)).toMatchObject({ status: "dead_letter" });

    const retry = await queueChatTurn({ ...submitted, request: { kind: "retry" } });
    geminiReply("Try the smallest input first.");
    await dispatchChatTurn(retry);
    expect(await getLatestChatTurn(userId, conversationId)).toMatchObject({ status: "completed" });
    expect(await db.message.count({ where: { conversationId, role: "user", content: "Show a second hint" } })).toBe(1);
    expect(await db.message.count({ where: { conversationId, role: "assistant", content: "Try the smallest input first." } })).toBe(1);
  });

  it("drafts sessions with assignment deadlines and creates tasks only once after approval", async () => {
    const provider = geminiReply(JSON.stringify({ sessions }));
    const submitted = { userId, conversationId, turnId: randomUUID(), request: { kind: "study_plan", assignmentId } } as const;
    await dispatchChatTurn(await queueChatTurn(submitted));
    expect(provider.mock.calls[0]?.[1].body).toContain("2090-01-09");
    const draft = await db.message.findFirstOrThrow({ where: { conversationId, role: STUDY_PLAN_ROLE } });
    expect(JSON.parse(draft.content).sessions).toEqual(sessions);
    const approvalId = `study-plan-${assignmentId}`;
    expect(await db.task.count({ where: { ownerId: userId, agentId } })).toBe(0);
    const results = await Promise.allSettled([decideApproval(userId, approvalId, "approve"), decideApproval(userId, approvalId, "approve")]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(await db.task.count({ where: { ownerId: userId, agentId } })).toBe(3);
    await dispatchChatTurn(await queueChatTurn({ ...submitted, turnId: randomUUID() }));
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await db.message.count({ where: { conversationId, role: STUDY_PLAN_ROLE } })).toBe(1);
  });
  it("uses explicitly attached notes for a generic question and keeps other owners' files out", async () => {
    const provider = geminiReply("Use a base case.");
    const conversation = await db.conversation.create({ data: { userId, agentId } });
    const attachment = await db.file.create({
      data: { ownerId: userId, name: "Lecture notes.txt", mimeType: "text/plain", size: 36, textContent: "A convergent series has a finite sum." },
    });
    const submit = (attachmentId: string) => queueChatTurn({
      userId, conversationId: conversation.id, turnId: randomUUID(),
      request: { kind: "chat", message: "Can you explain this?", attachmentIds: [attachmentId] },
    });
    await dispatchChatTurn(await submit(attachment.id));
    expect(provider.mock.calls[0]?.[1].body).toContain("A convergent series has a finite sum.");
    const source = await db.message.findFirstOrThrow({ where: { conversationId: conversation.id, role: REPLY_SOURCES_ROLE } });
    expect(JSON.parse(source.content)).toEqual([{ id: attachment.id, label: attachment.name }]);

    const other = await db.user.create({ data: { name: "Another student", email: `${randomUUID()}@test.local`, passwordHash: "test" } });
    const privateFile = await db.file.create({
      data: { ownerId: other.id, name: "Private.txt", mimeType: "text/plain", size: 11, textContent: "Private contents." },
    });
    await dispatchChatTurn(await submit(privateFile.id));
    expect(await getLatestChatTurn(userId, conversation.id)).toMatchObject({ status: "dead_letter" });
    expect(provider).toHaveBeenCalledTimes(1);
  });

});
