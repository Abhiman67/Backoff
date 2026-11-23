import { db } from "@/lib/db";
import { sourceIds } from "@/lib/assignments";

export async function classroomAttachmentStates(ownerId: string, taskId: string) {
  const rows = await db.classroomAttachment.findMany({
    where: { taskId, task: { ownerId } },
    select: { id: true, driveFileId: true, title: true, lastError: true, attemptedAt: true,
      file: { select: { id: true, status: true, ownerId: true } } },
    orderBy: { id: "asc" },
  });
  return rows.map(({ file, ...row }) => {
    const visibleFile = file?.ownerId === ownerId ? file : null;
    const status = visibleFile?.status ?? (row.lastError ? "failed" : row.attemptedAt ? "processing" : "queued");
    return { id: row.id, driveFileId: row.driveFileId, title: row.title, status, lastError: row.lastError, fileId: visibleFile?.id ?? null };
  });
}

export async function assignmentFileSourceIds(ownerId: string, task: { id: string; assignmentSourceIds: unknown }) {
  const auto = await db.classroomAttachment.findMany({
    where: { taskId: task.id, task: { ownerId }, file: { ownerId, status: "ready" } },
    select: { fileId: true },
  });
  return [...new Set([...auto.flatMap(({ fileId }) => fileId ? [fileId] : []), ...sourceIds(task.assignmentSourceIds)])];
}
