import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleApi, invalid, notFound } from "@/lib/api";
import { classroomAttachmentStates } from "@/lib/assignment-file-sources";
import { sourceIds, practiceQuestions } from "@/lib/assignments";

const updateSchema = z.object({ sourceIds: z.array(z.string().min(1)).max(20).optional(), nextAction: z.string().trim().max(500).optional() });

export const GET = handleApi<{ id: string }>(async (_, { userId }, { id }) => {
  const task = await db.task.findFirst({ where: { id, ownerId: userId }, include: { subject: { select: { id: true, name: true, classroomCourseId: true } } } });
  if (!task) throw notFound("Assignment");
  const questions = practiceQuestions(task.practiceQuestions);
  const [files, topics, evidence, sessions, classroomAttachments] = await Promise.all([
    db.file.findMany({ where: { ownerId: userId, status: "ready" }, select: { id: true, name: true, subjectId: true, sourceProvider: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    task.subjectId ? db.topic.findMany({ where: { ownerId: userId, subjectId: task.subjectId }, orderBy: { position: "asc" } }) : [],
    db.masteryEvidence.findMany({ where: { ownerId: userId, questionId: { in: questions.map((question) => question.id) } }, select: { questionId: true, score: true } }),
    task.subjectId ? db.revisionSession.findMany({ where: { ownerId: userId, subjectId: task.subjectId, status: "planned" }, orderBy: { scheduledFor: "asc" }, take: 10 }) : [],
    task.externalProvider === "classroom" ? classroomAttachmentStates(userId, task.id) : [],
  ]);
  const selected = new Set(sourceIds(task.assignmentSourceIds));
  return NextResponse.json({
    task: { ...task, practiceQuestions: questions },
    files, classroomAttachments, sources: files.filter((file) => selected.has(file.id)), topics, sessions,
    results: Object.fromEntries(evidence.filter((item) => item.questionId).map((item) => [item.questionId, item.score])),
  }, { headers: { "Cache-Control": "no-store" } });
});

export const PATCH = handleApi<{ id: string }>(async (req, { userId }, { id }) => {
  const task = await db.task.findFirst({ where: { id, ownerId: userId } });
  if (!task) throw notFound("Assignment");
  const parsed = updateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw invalid("Invalid assignment update.");
  const ids = parsed.data.sourceIds ? [...new Set(parsed.data.sourceIds)] : undefined;
  if (ids) {
    const count = await db.file.count({ where: { ownerId: userId, id: { in: ids }, status: "ready" } });
    if (count !== ids.length) throw invalid("Choose files from your ready workspace sources.");
  }
  const previous = sourceIds(task.assignmentSourceIds);
  const sourcesChanged = ids !== undefined && (ids.length !== previous.length || ids.some((fileId) => !previous.includes(fileId)));
  const updated = await db.task.update({ where: { id }, data: {
    ...(ids ? { assignmentSourceIds: ids, ...(sourcesChanged ? { practiceQuestions: [] } : {}) } : {}),
    ...(parsed.data.nextAction !== undefined ? { nextAction: parsed.data.nextAction } : {}),
  } });
  return NextResponse.json({ task: updated });
});
