import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleApi, invalid, notFound, HttpError } from "@/lib/api";
import { generateStudyMaterial } from "@/lib/ai-study";
import { assignmentFileSourceIds } from "@/lib/assignment-file-sources";
import { practiceQuestions, type PracticeQuestion } from "@/lib/assignments";
import { deriveMastery } from "@/lib/learning";
import { chunkText } from "@/lib/chunking";

export const POST = handleApi<{ id: string }>(async (_, { userId }, { id }) => {
  const task = await db.task.findFirst({ where: { id, ownerId: userId } });
  if (!task) throw notFound("Assignment");
  if (!task.subjectId) throw invalid("Link this assignment to a course before practice.");
  const ids = await assignmentFileSourceIds(userId, task);
  if (!ids.length) throw invalid("Add at least one source to this assignment.");
  const stored = await db.fileChunk.findMany({
    where: { ownerId: userId, fileId: { in: ids }, file: { status: "ready" } },
    include: { file: { select: { name: true } } }, orderBy: { index: "asc" }, take: 30,
  });
  const chunks = stored.map((chunk) => ({ fileId: chunk.fileId, file: chunk.file, content: chunk.content, index: chunk.index }));
  const indexed = new Set(chunks.map((chunk) => chunk.fileId));
  const notes = await db.file.findMany({ where: { ownerId: userId, id: { in: ids.filter((fileId) => !indexed.has(fileId)) }, status: "ready", mimeType: "text/markdown" }, select: { id: true, name: true, textContent: true } });
  for (const note of notes) for (const part of chunkText(note.textContent, 800, 120).slice(0, 10)) {
    chunks.push({ fileId: note.id, file: { name: note.name }, content: part.content, index: part.index });
  }
  if (!chunks.length) throw invalid("The selected sources have no searchable text yet.");
  const chosen = chunks.filter((chunk) => chunk.content.length >= 120).slice(0, 3);
  if (!chosen.length) throw invalid("Selected sources need more text for useful practice.");
  const questions: PracticeQuestion[] = [];
  for (const chunk of chosen) {
    let generated: Awaited<ReturnType<typeof generateStudyMaterial>>;
    try { generated = await generateStudyMaterial({ action: "quiz", sourceName: chunk.file.name, sourceText: chunk.content }); }
    catch { generated = null; }
    const aiItem = generated && "quiz" in generated ? generated.quiz[0] : null;
    const heading = chunk.content.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim();
    const concept = heading || chunk.content.replace(/\s+/g, " ").split(" ").slice(0, 7).join(" ");
    const item = aiItem ?? {
      q: `Without looking, explain the main idea in ${chunk.file.name}, excerpt ${chunk.index + 1}.`,
      hint: "Try to recall the point, then compare with the excerpt.",
      answer: chunk.content.slice(0, 500),
      concept,
    };
    questions.push({
      id: crypto.randomUUID(), q: item.q.slice(0, 500), hint: (item.hint ?? "Review the source excerpt.").slice(0, 300),
      answer: item.answer.slice(0, 1000), concept: (item.concept ?? concept).slice(0, 100),
      fileId: chunk.fileId, fileName: chunk.file.name, chunkIndex: chunk.index, excerpt: chunk.content.slice(0, 800),
    });
  }
  if (!questions.length) throw new HttpError("PRACTICE_GENERATION_FAILED", 502, "Could not make grounded questions from these sources.", true);
  await db.task.update({ where: { id }, data: { practiceQuestions: questions } });
  return NextResponse.json({ questions }, { status: 201 });
}, { rateLimit: { keyPrefix: "assignment-practice", limit: 6, windowSec: 60 } });

const gradeSchema = z.object({ questionId: z.string().uuid(), correct: z.boolean() });

export const PATCH = handleApi<{ id: string }>(async (req, { userId }, { id }) => {
  const task = await db.task.findFirst({ where: { id, ownerId: userId } });
  if (!task) throw notFound("Assignment");
  if (!task.subjectId) throw invalid("Assignment has no course.");
  const parsed = gradeSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw invalid("Choose a question and a result.");
  const question = practiceQuestions(task.practiceQuestions).find((item) => item.id === parsed.data.questionId);
  if (!question) throw notFound("Practice question");
  const existingTopics = await db.topic.findMany({ where: { ownerId: userId, subjectId: task.subjectId } });
  let topic = existingTopics.find((item) => item.name.toLocaleLowerCase() === question.concept.toLocaleLowerCase());
  if (!topic) topic = await db.topic.create({ data: { ownerId: userId, subjectId: task.subjectId, name: question.concept } });
  const evidence = await db.masteryEvidence.upsert({ where: { questionId: question.id }, update: {}, create: {
    ownerId: userId, topicId: topic.id, questionId: question.id, kind: "quiz", score: parsed.data.correct ? 1 : 0, total: 1,
    note: `Assignment ${task.id}; source ${question.fileName}, excerpt ${question.chunkIndex + 1}; student self-checked.`,
  } });
  const history = await db.masteryEvidence.findMany({ where: { topicId: topic.id }, orderBy: { createdAt: "asc" }, take: 100 });
  const mastery = deriveMastery(history.map((item) => ({ kind: item.kind, score: item.score, total: item.total, note: item.note, createdAt: item.createdAt.getTime() })));
  await db.topic.update({ where: { id: topic.id }, data: { mastery } });
  if (evidence.score === 0) {
    const title = `Review ${topic.name} · ${task.title}`.slice(0, 120);
    const existing = await db.revisionSession.findFirst({ where: { ownerId: userId, subjectId: task.subjectId, title, status: "planned" } });
    if (!existing) await db.revisionSession.create({ data: { ownerId: userId, subjectId: task.subjectId, title, scheduledFor: new Date(Date.now() + 86400000), durationMin: 20 } });
  }
  return NextResponse.json({ evidence, topic: { id: topic.id, name: topic.name, mastery } });
});
