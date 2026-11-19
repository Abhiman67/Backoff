import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleApi, invalid, notFound } from "@/lib/api";

const patchNoteSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  content: z.string().max(2_000_000).optional(),
  subjectId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  careerGoalId: z.string().nullable().optional(),
  folder: z.string().max(80).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

export const PATCH = handleApi<{ id: string }>(async (req, { userId }, { id }) => {
  const existing = await db.file.findFirst({ where: { id, ownerId: userId, mimeType: "text/markdown", status: { not: "deleted" } } });
  if (!existing) throw notFound("Note");
  const parsed = patchNoteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw invalid("Check the note fields and keep content under 2 MB.");
  const body = parsed.data;
  const title = body.title;
  const content = body.content;
  if (body.subjectId && !(await db.subject.findFirst({ where: { id: body.subjectId, ownerId: userId }, select: { id: true } }))) throw invalid("Subject not found.");
  if (body.projectId && !(await db.project.findFirst({ where: { id: body.projectId, ownerId: userId }, select: { id: true } }))) throw invalid("Project not found.");
  if (body.careerGoalId && !(await db.careerGoal.findFirst({ where: { id: body.careerGoalId, ownerId: userId }, select: { id: true } }))) throw invalid("Career goal not found.");
  if (body.content !== undefined || title !== undefined) await db.noteRevision.create({ data: { ownerId: userId, fileId: id, title: title ?? existing.name.replace(/\.md$/, ""), content: content ?? existing.textContent } });
  const note = await db.file.update({ where: { id }, data: { ...(title !== undefined ? { name: `${title}.md` } : {}), ...(content !== undefined ? { textContent: content, size: Buffer.byteLength(content) } : {}), ...(body.subjectId !== undefined ? { subjectId: body.subjectId } : {}), ...(body.projectId !== undefined ? { projectId: body.projectId } : {}), ...(body.careerGoalId !== undefined ? { careerGoalId: body.careerGoalId } : {}), ...(body.folder !== undefined ? { folder: body.folder } : {}), ...(body.tags !== undefined ? { tags: body.tags } : {}) }, select: { id: true, name: true, size: true, textContent: true, subjectId: true, projectId: true, careerGoalId: true, folder: true, tags: true } });
  if (body.content !== undefined) {
    await db.noteLink.deleteMany({ where: { ownerId: userId, fromId: id } });
    const targets = [...new Set([...body.content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].trim()).filter(Boolean))].slice(0, 100);
    const linked = await db.file.findMany({ where: { ownerId: userId, mimeType: "text/markdown", status: { not: "deleted" }, name: { in: targets.map((x) => `${x}.md`) } }, select: { id: true, name: true } });
    if (linked.length) await Promise.all(linked.filter((x) => x.id !== id).map((x) => db.noteLink.upsert({ where: { fromId_toId: { fromId: id, toId: x.id } }, create: { ownerId: userId, fromId: id, toId: x.id, label: x.name.replace(/\.md$/, "") }, update: { label: x.name.replace(/\.md$/, "") } })));
  }
  if (title !== undefined && title !== existing.name.replace(/\.md$/i, "")) {
    await db.noteLink.deleteMany({ where: { ownerId: userId, toId: id, label: existing.name.replace(/\.md$/i, "") } });
    const incomingCandidates = await db.file.findMany({ where: { ownerId: userId, mimeType: "text/markdown", status: { not: "deleted" }, id: { not: id }, textContent: { contains: `[[${title}]]` } }, select: { id: true, textContent: true } });
    const incoming = incomingCandidates.filter((source) => [...source.textContent.matchAll(/\[\[([^\]]+)\]\]/g)].some((match) => match[1].trim().toLocaleLowerCase() === title.toLocaleLowerCase()));
    if (incoming.length) await Promise.all(incoming.map((source) => db.noteLink.upsert({ where: { fromId_toId: { fromId: source.id, toId: id } }, create: { ownerId: userId, fromId: source.id, toId: id, label: title }, update: { label: title } })));
  }
  return NextResponse.json({ note });
}, { rateLimit: { keyPrefix: "notes-update", limit: 120, windowSec: 3600 } });

export const PUT = PATCH;

export const GET = handleApi<{ id: string }>(async (request, { userId }, { id }) => {
  const note = await db.file.findFirst({ where: { id, ownerId: userId, mimeType: "text/markdown", status: { not: "deleted" } } });
  if (!note) throw notFound("Note");
  if (new URL(request.url).searchParams.get("format") === "json") {
    return NextResponse.json({ note: { id: note.id, name: note.name, size: note.size, textContent: note.textContent, subjectId: note.subjectId, projectId: note.projectId, careerGoalId: note.careerGoalId, folder: note.folder, tags: note.tags } }, { headers: { "Cache-Control": "no-store" } });
  }
  const safeFilename = note.name.replace(/[\r\n"\\/]/g, "_");
  return new NextResponse(note.textContent, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${safeFilename}"` } });
});

export const DELETE = handleApi<{ id: string }>(async (_req, { userId }, { id }) => {
  const existing = await db.file.findFirst({ where: { id, ownerId: userId, mimeType: "text/markdown", status: { not: "deleted" } } });
  if (!existing) throw notFound("Note");
  await db.$transaction([
    db.file.update({ where: { id }, data: { status: "deleted" } }),
    db.noteLink.deleteMany({ where: { ownerId: userId, OR: [{ fromId: id }, { toId: id }] } }),
  ]);
  return NextResponse.json({ ok: true });
});
