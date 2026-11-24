import type { File } from "@prisma/client";
import { db } from "@/lib/db";
import { getQuota } from "@/lib/quotas";
import { HttpError, invalid } from "@/lib/http-error";
import { objectStorage, storageKeyFor } from "@/lib/storage";
import { enqueue } from "@/lib/jobs/queue";
import { getDriveAccessToken } from "./drive-token";
import { downloadDriveFile } from "./drive";

const ALLOWED = [".pdf", ".txt", ".md", ".docx"];

async function prepareClassroomFile(file: File) {
  if (file.status === "deleted") throw new HttpError("CLASSROOM_FILE_REMOVED", 409, "This file was removed from Files & notes.");
  let queuedFile = file;
  const retrying = file.status === "failed";
  if (retrying && file.storageKey) {
    const retried = await db.file.updateMany({ where: { id: file.id, ownerId: file.ownerId, status: "failed", storageKey: { not: null } }, data: { status: "uploaded", failureReason: null, textContent: "" } });
    if (retried.count) queuedFile = await db.file.findUniqueOrThrow({ where: { id: file.id } });
  }
  if (queuedFile.status === "uploaded") {
    const result = await enqueue("file.extract", { fileId: file.id, ownerId: file.ownerId }, {
      idempotencyKey: retrying ? `file.extract:${file.id}:classroom-retry:${Date.now()}` : `file.extract:${file.id}`, maxRetries: 0,
    });
    if (result.status === "dead_letter") {
      await db.file.updateMany({ where: { id: file.id, status: "uploaded" }, data: { status: "failed", failureReason: "EXTRACT_FAILED" } });
    }
  }
  return db.file.findUniqueOrThrow({ where: { id: file.id } });
}

export async function importClassroomFile({ userId, driveFileId, material }: {
  userId: string;
  driveFileId: string;
  material: { courseId: string; courseName: string };
}) {
  const existing = await db.file.findFirst({ where: { ownerId: userId, sourceProvider: "classroom", sourceExternalId: driveFileId } });
  if (existing) return { file: await prepareClassroomFile(existing), alreadyImported: true };
  const quota = await getQuota(userId, "files");
  if (!quota.allowed) throw new HttpError("QUOTA_EXCEEDED", 402, "File quota exceeded", false, { quota });
  let driveToken: string | null;
  try { driveToken = await getDriveAccessToken(userId); }
  catch { throw new HttpError("TOKEN_EXPIRED", 401, "Google Drive access expired. Reconnect Drive to import file contents."); }
  if (!driveToken) throw new HttpError("DRIVE_NOT_CONNECTED", 409, "Connect Google Drive separately to import file contents. Classroom materials can still be opened in Google.");
  let download;
  try { download = await downloadDriveFile(driveToken, driveFileId); }
  catch (error) { throw new HttpError("CLASSROOM_FILE_DOWNLOAD_FAILED", 502, error instanceof Error ? error.message : "Could not download this Classroom attachment."); }
  if (!ALLOWED.some((extension) => download.name.toLowerCase().endsWith(extension))) throw invalid("This attachment format is not supported yet. Import a PDF, TXT, MD, or DOCX file.");
  const key = storageKeyFor(userId, crypto.randomUUID(), download.name);
  await objectStorage.put(key, download.bytes, download.mimeType);
  const subject = await db.subject.findUnique({ where: { ownerId_classroomCourseId: { ownerId: userId, classroomCourseId: material.courseId } }, select: { id: true } });
  let saved;
  try {
    saved = await db.file.create({ data: {
      ownerId: userId, name: download.name, mimeType: download.mimeType, size: download.bytes.length,
      status: "uploaded", textContent: "", storageKey: key, sourceProvider: "classroom", sourceExternalId: driveFileId,
      folder: `Classroom · ${material.courseName}`, subjectId: subject?.id,
      tags: ["classroom", material.courseName].filter(Boolean),
    } });
  } catch (error) {
    await objectStorage.del(key).catch(() => undefined);
    const duplicate = await db.file.findFirst({ where: { ownerId: userId, sourceProvider: "classroom", sourceExternalId: driveFileId } });
    if (duplicate) return { file: await prepareClassroomFile(duplicate), alreadyImported: true };
    throw error;
  }
  return { file: await prepareClassroomFile(saved), alreadyImported: false };
}

export async function processClassroomAttachment(id: string) {
  const attachment = await db.classroomAttachment.findUnique({
    where: { id },
    include: { task: { include: { subject: true } } },
  });
  if (!attachment || attachment.fileId || attachment.task.externalProvider !== "classroom") return;
  const { ownerId, subject } = attachment.task;
  if (!subject?.classroomCourseId) return;
  const settings = await db.integrationAccount.findUnique({
    where: { ownerId_provider: { ownerId, provider: "classroom" } },
    select: { autoImportAttachments: true, accessTokenEncrypted: true },
  });
  if (!settings?.autoImportAttachments || !settings.accessTokenEncrypted) return;
  const current = new Date();
  const claim = await db.classroomAttachment.updateMany({
    where: { id, fileId: null, OR: [{ attemptedAt: null }, { attemptedAt: { lt: new Date(current.getTime() - 15 * 60_000) } }] },
    data: { attemptedAt: current, lastError: null },
  });
  if (!claim.count) return;

  try {
    const { file } = await importClassroomFile({
      userId: ownerId,
      driveFileId: attachment.driveFileId,
      material: { courseId: subject.classroomCourseId, courseName: subject.name },
    });
    await db.classroomAttachment.updateMany({ where: { id, attemptedAt: current }, data: { fileId: file.id } });
  } catch (error) {
    await db.classroomAttachment.updateMany({
      where: { id, attemptedAt: current },
      data: { lastError: error instanceof HttpError ? error.message : "Could not import this file. Sync Classroom again to retry." },
    });
  }
}
