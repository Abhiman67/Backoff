import { NextResponse } from "next/server";
import { DEFAULT_CONVERSATION_TITLE, titleFromFirstMessage } from "@/lib/conversation-title";
import { db } from "@/lib/db";
import { handleApi, notFound } from "@/lib/api";

export const GET = handleApi<{ agentId: string }>(async (req, { userId: id }, params) => {
  const { agentId } = params;
  const agent = await db.agent.findFirst({ where: { id: agentId, ownerId: id } });
  if (!agent) throw notFound("Agent");
  const url = new URL(req.url);
  const take = Math.min(Math.max(Number(url.searchParams.get("take") || 50), 1), 100);
  const cursor = url.searchParams.get("cursor");
  const conversations = await db.conversation.findMany({
    where: { userId: id, agentId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    select: {
      id: true, title: true, projectId: true, updatedAt: true,
      messages: {
        where: { role: "user" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 1,
        select: { content: true },
      },
    },
  });
  const hasMore = conversations.length > take;
  if (hasMore) conversations.pop();
  const listed = conversations.map(({ messages, ...conversation }) => ({
    ...conversation,
    title: conversation.title === DEFAULT_CONVERSATION_TITLE && messages[0]
      ? titleFromFirstMessage(messages[0].content)
      : conversation.title,
  }));
  return NextResponse.json({ conversations: listed, nextCursor: hasMore ? conversations.at(-1)?.id ?? null : null });
});
