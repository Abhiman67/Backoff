import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getQuota } from "@/lib/quotas";
import { handleApi, HttpError, invalid } from "@/lib/api";

const backupSchema = z.object({
  format: z.literal("backoff-notes-export"),
  version: z.literal(1),
  notes: z.array(z.object({
    title: z.string().trim().min(1).max(160),
    content: z.string().max(2_000_000),
    folder: z.string().max(80).optional(),
    tags: z.array(z.string().max(40)).max(20).optional(),
    subjectId: z.string().max(100).nullable().optional(),
    projectId: z.string().max(100).nullable().optional(),
    careerGoalId: z.string().max(100).nullable().optional(),
  })).min(1).max(500),
});

type ImportedNote = z.infer<typeof backupSchema>["notes"][number];

export const POST = handleApi(async (request, { userId }) => {
  const form = await request.formData();
  const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
  if (!files.length || files.length > 20) throw invalid("Choose 1–20 Markdown files or one VidyaSarthi notes backup.");

  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > 10 * 1024 * 1024) throw invalid("The selected files must total 10 MB or less.");

  let imported: ImportedNote[];
  if (files.length === 1 && files[0].name.toLowerCase().endsWith(".json")) {
    let payload: unknown;
    try { payload = JSON.parse(await files[0].text()); }
    catch { throw invalid("That backup is not valid JSON."); }
    const parsed = backupSchema.safeParse(payload);
    if (!parsed.success) throw invalid("Choose a valid VidyaSarthi notes backup.");
    imported = parsed.data.notes;
  } else {
    if (files.some((file) => !file.name.toLowerCase().endsWith(".md") && !file.name.toLowerCase().endsWith(".markdown"))) {
      throw invalid("Import Markdown files (.md or .markdown) or one VidyaSarthi JSON backup.");
    }
    imported = await Promise.all(files.map(async (file) => {
      if (file.size > 2 * 1024 * 1024) throw invalid(`${file.name} is larger than the 2 MB per-note limit.`);
      const title = file.name.replace(/\.(md|markdown)$/i, "").trim().slice(0, 160);
      if (!title) throw invalid("Every Markdown file needs a filename to use as its note title.");
      return { title, content: await file.text(), folder: "Imported", tags: [] };
    }));
  }

  const existingNames = await db.file.findMany({
    where: { ownerId: userId, mimeType: "text/markdown", status: { not: "deleted" } },
    select: { name: true },
  });
  const knownNames = new Set(existingNames.map((note) => note.name.toLocaleLowerCase()));
  const uniqueNotes = imported.filter((note) => {
    const name = `${note.title}.md`.toLocaleLowerCase();
    if (knownNames.has(name)) return false;
    knownNames.add(name);
    return true;
  });
  const skipped = imported.length - uniqueNotes.length;
  const quota = await getQuota(userId, "files");
  if (quota.remaining < uniqueNotes.length) {
    throw new HttpError("QUOTA_EXCEEDED", 402, `Your plan has room for ${quota.remaining} more files.`, false, { quota });
  }
  const [ownedSubjects, ownedProjects, ownedGoals] = await Promise.all([
    db.subject.findMany({ where: { ownerId: userId }, select: { id: true } }),
    db.project.findMany({ where: { ownerId: userId }, select: { id: true } }),
    db.careerGoal.findMany({ where: { ownerId: userId }, select: { id: true } }),
  ]);
  const subjectIds = new Set(ownedSubjects.map((item) => item.id));
  const projectIds = new Set(ownedProjects.map((item) => item.id));
  const careerGoalIds = new Set(ownedGoals.map((item) => item.id));

  const created = uniqueNotes.length ? await db.$transaction(async (tx) => {
    const notes = [];
    for (const note of uniqueNotes) {
      notes.push(await tx.file.create({ data: {
        ownerId: userId,
        name: `${note.title}.md`,
        mimeType: "text/markdown",
        size: Buffer.byteLength(note.content),
        status: "ready",
        textContent: note.content,
        storageKey: `note:${userId}:${crypto.randomUUID()}`,
        folder: note.folder || "Imported",
        tags: note.tags ?? [],
        subjectId: note.subjectId && subjectIds.has(note.subjectId) ? note.subjectId : null,
        projectId: note.projectId && projectIds.has(note.projectId) ? note.projectId : null,
        careerGoalId: note.careerGoalId && careerGoalIds.has(note.careerGoalId) ? note.careerGoalId : null,
      }, select: { id: true, name: true, textContent: true, size: true, folder: true, tags: true, subjectId: true, projectId: true, careerGoalId: true } }));
    }

    const newTitles = new Set(notes.map((note) => note.name.replace(/\.md$/i, "").toLocaleLowerCase()));
    const referencesToNewNotes = uniqueNotes.flatMap((note) => [...new Set([...note.content.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1].trim()))].filter((target) => newTitles.has(target.toLocaleLowerCase())).map((target) => `[[${target}]]`));
    const inboundSources = referencesToNewNotes.length ? await tx.file.findMany({
      where: { ownerId: userId, mimeType: "text/markdown", status: { not: "deleted" }, OR: [...new Set(referencesToNewNotes)].map((reference) => ({ textContent: { contains: reference } })) },
      select: { id: true, name: true, textContent: true },
    }) : [];
    const allNotes = await tx.file.findMany({ where: { ownerId: userId, mimeType: "text/markdown", status: { not: "deleted" } }, select: { id: true, name: true } });
    const byName = new Map(allNotes.map((note) => [note.name.toLocaleLowerCase(), note]));
    const sources = [...new Map([...inboundSources, ...notes].map((note) => [note.id, note])).values()];
    for (const note of sources) {
      const targets = [...new Set([...note.textContent.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1].trim()).filter(Boolean))].slice(0, 100);
      for (const target of targets) {
        const linked = byName.get(`${target}.md`.toLocaleLowerCase());
        if (!linked || linked.id === note.id) continue;
        await tx.noteLink.upsert({
          where: { fromId_toId: { fromId: note.id, toId: linked.id } },
          create: { ownerId: userId, fromId: note.id, toId: linked.id, label: linked.name.replace(/\.md$/i, "") },
          update: { label: linked.name.replace(/\.md$/i, "") },
        });
      }
    }
    return notes;
  }) : [];

  return NextResponse.json({ imported: created.length, skipped, notes: created.map((note) => ({ id: note.id, name: note.name, textContent: note.textContent, size: note.size, folder: note.folder, tags: note.tags, subjectId: note.subjectId, projectId: note.projectId, careerGoalId: note.careerGoalId })) }, { status: created.length ? 201 : 200 });
}, { rateLimit: { keyPrefix: "notes-import", limit: 5, windowSec: 3600 } });
