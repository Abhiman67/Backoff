import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getQuota } from "@/lib/quotas";
import { handleApi, HttpError, invalid } from "@/lib/api";

const createNoteSchema = z.object({
  title: z.string().trim().min(1).max(160),
  content: z.string().max(2_000_000).optional(),
  subjectId: z.string().optional(),
  projectId: z.string().optional(),
  careerGoalId: z.string().optional(),
  folder: z.string().max(80).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export const GET = handleApi(async (request, { userId }) => {
  const url = new URL(request.url);
  const requestedTake = Number(url.searchParams.get("take") || 100);
  const take = Number.isFinite(requestedTake) ? Math.min(Math.max(Math.floor(requestedTake), 1), 500) : 100;
  const cursor = url.searchParams.get("cursor");
  if (cursor && (cursor.length > 100 || !(await db.file.findFirst({ where: { id: cursor, ownerId: userId, mimeType: "text/markdown", status: { not: "deleted" } }, select: { id: true } })))) {
    throw invalid("This notes page cursor is no longer valid. Refresh the note list.");
  }
  const query = url.searchParams.get("q")?.trim().slice(0, 120) ?? "";
  const baseWhere = {
    ownerId: userId,
    mimeType: "text/markdown",
    status: { not: "deleted" },
  };
  const tagMatches = query ? await db.file.findMany({ where: baseWhere, select: { id: true, tags: true } }) : [];
  const matchingTagIds = tagMatches.filter((note) => JSON.stringify(note.tags ?? []).toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((note) => note.id);
  const where = {
    ...baseWhere,
    ...(query ? { OR: [
      { name: { contains: query } },
      { textContent: { contains: query } },
      { folder: { contains: query } },
      ...(matchingTagIds.length ? [{ id: { in: matchingTagIds } }] : []),
    ] } : {}),
  };
  const [notes, total] = await Promise.all([
    db.file.findMany({ where, select: {
      id: true, name: true, size: true, subjectId: true, projectId: true, careerGoalId: true, folder: true, tags: true, createdAt: true,
      outgoingLinks: { select: { toId: true, label: true } }, incomingLinks: { select: { fromId: true, label: true } },
    }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: take + 1, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) }),
    db.file.count({ where }),
  ]);
  const hasMore = notes.length > take;
  if (hasMore) notes.pop();
  return NextResponse.json({ notes, total, nextCursor: hasMore ? notes.at(-1)?.id ?? null : null }, { headers: { "Cache-Control": "no-store" } });
}, { rateLimit: { keyPrefix: "notes-search", limit: 120, windowSec: 60 } });

export const POST = handleApi(async (req, { userId }) => {
  const parsed = createNoteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw invalid("Add a note title and keep the note under 2 MB.");
  const body = parsed.data;
  const title = body.title;
  const content = body.content ?? "";
  const quota = await getQuota(userId, "files");
  if (!quota.allowed) throw new HttpError("QUOTA_EXCEEDED", 402, "Note quota exceeded.", false, { quota });
  if (body.subjectId && !(await db.subject.findFirst({ where: { id: body.subjectId, ownerId: userId }, select: { id: true } }))) throw invalid("Subject not found.");
  if (body.projectId && !(await db.project.findFirst({ where: { id: body.projectId, ownerId: userId }, select: { id: true } }))) throw invalid("Project not found.");
  if (body.careerGoalId && !(await db.careerGoal.findFirst({ where: { id: body.careerGoalId, ownerId: userId }, select: { id: true } }))) throw invalid("Career goal not found.");
  const note = await db.file.create({ data: { ownerId: userId, name: `${title}.md`, mimeType: "text/markdown", size: Buffer.byteLength(content), status: "ready", textContent: content, storageKey: `note:${userId}:${crypto.randomUUID()}`, subjectId: body.subjectId || null, projectId: body.projectId || null, careerGoalId: body.careerGoalId || null, folder: body.folder || "Inbox", tags: body.tags ?? [] }, select: { id: true, name: true, size: true, textContent: true, subjectId: true, projectId: true, careerGoalId: true, folder: true, tags: true } });
  const targets = [...new Set([...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].trim()).filter(Boolean))].slice(0, 100);
  const linked = await db.file.findMany({ where: { ownerId: userId, mimeType: "text/markdown", status: { not: "deleted" }, name: { in: targets.map((x) => `${x}.md`) } }, select: { id: true, name: true } });
  if (linked.length) await Promise.all(linked.filter((x) => x.id !== note.id).map((x) => db.noteLink.upsert({ where: { fromId_toId: { fromId: note.id, toId: x.id } }, create: { ownerId: userId, fromId: note.id, toId: x.id, label: x.name.replace(/\.md$/, "") }, update: { label: x.name.replace(/\.md$/, "") } })));
  const incoming = await db.file.findMany({ where: { ownerId: userId, mimeType: "text/markdown", status: { not: "deleted" }, id: { not: note.id }, textContent: { contains: `[[${title}]]` } }, select: { id: true, textContent: true } });
  const inbound = incoming.filter((source) => [...source.textContent.matchAll(/\[\[([^\]]+)\]\]/g)].some((match) => match[1].trim().toLocaleLowerCase() === title.toLocaleLowerCase()));
  if (inbound.length) await Promise.all(inbound.map((source) => db.noteLink.upsert({ where: { fromId_toId: { fromId: source.id, toId: note.id } }, create: { ownerId: userId, fromId: source.id, toId: note.id, label: title }, update: { label: title } })));
  return NextResponse.json({ note }, { status: 201 });
}, { rateLimit: { keyPrefix: "notes-create", limit: 40, windowSec: 3600 } });
