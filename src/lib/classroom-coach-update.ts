import { db } from "@/lib/db";
import {
  assignmentQuestionPrefix, CLASSROOM_UPDATE_ROLE, classroomUpdateSchema,
  readThreadData, type ClassroomUpdate,
} from "@/lib/study-coach-thread";

type AssignmentSnapshot = Pick<ClassroomUpdate, "assignmentId" | "title" | "dueDate">
  & Required<Pick<ClassroomUpdate, "status">>;

function classifyChange(previous: ClassroomUpdate | null, current: AssignmentSnapshot): ClassroomUpdate["change"] {
  if (!previous) return current.status === "completed" ? undefined : "new";
  if (current.status === "completed") return previous.status === "completed" ? undefined : "completed";
  if (previous.dueDate !== current.dueDate) return "deadline";
  if (previous.status !== current.status) {
    if (current.status === "due_soon" || current.status === "overdue") return current.status;
    if (previous.status) return "updated";
  }
  return previous.title !== current.title ? "updated" : undefined;
}

/** Keep one card per assignment and resurface it only when its coursework changes. */
export async function updateClassroomCoachCard(threadId: string, snapshot: AssignmentSnapshot) {
  const id = `classroom-update-${snapshot.assignmentId}`;
  const saved = await db.message.findUnique({ where: { id }, select: { content: true } });
  const previous = saved && readThreadData(classroomUpdateSchema, saved.content);
  const change = classifyChange(previous, snapshot);
  if (!change) {
    if (saved && previous && !previous.status) {
      await db.message.updateMany({
        where: { id, conversationId: threadId, content: saved.content },
        data: { content: JSON.stringify({ ...previous, status: snapshot.status }) },
      });
    }
    return;
  }

  const question = snapshot.status === "completed" ? null : await db.message.findFirst({
    where: { conversationId: threadId, role: "user", id: { startsWith: assignmentQuestionPrefix(snapshot.assignmentId) } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { content: true },
  });
  const lastQuestion = question?.content.replace(/\s+/g, " ").trim();
  const content = JSON.stringify({
    ...snapshot, change,
    lastQuestion: lastQuestion && lastQuestion.length > 240 ? `${lastQuestion.slice(0, 239)}…` : lastQuestion,
  });
  const now = new Date();

  await db.$transaction(async (tx) => {
    if (saved) {
      const changed = await tx.message.updateMany({
        where: { id, conversationId: threadId, content: saved.content },
        data: { content, createdAt: now },
      });
      if (!changed.count) return;
    } else {
      await tx.message.upsert({
        where: { id },
        create: { id, conversationId: threadId, role: CLASSROOM_UPDATE_ROLE, content, createdAt: now },
        update: {},
      });
    }
    await tx.conversation.update({ where: { id: threadId }, data: { updatedAt: now } });
  });
}
