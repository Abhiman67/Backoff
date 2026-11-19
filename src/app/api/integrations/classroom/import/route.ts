import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleApi, HttpError, invalid } from "@/lib/api";
import { getQuota } from "@/lib/quotas";
import { getClassroomAccessToken } from "@/lib/integrations/classroom-token";
import { listClassroomMaterials } from "@/lib/integrations/classroom";
import { getDriveAccessToken } from "@/lib/integrations/drive-token";
import { downloadDriveFile } from "@/lib/integrations/drive";
import { objectStorage, storageKeyFor } from "@/lib/storage";
import "@/lib/jobs/processors";
import { enqueue } from "@/lib/jobs/queue";
import { CLASSROOM_MATERIALS_SCOPE } from "@/lib/integrations/scopes";

const bodySchema = z.object({ driveFileId: z.string().min(1).max(256) });
const ALLOWED = [".pdf", ".txt", ".md", ".docx"];

export const POST = handleApi(async (req, { userId }) => {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw invalid("Choose a valid Classroom attachment.");
  let classroomToken: string | null;
  try { classroomToken = await getClassroomAccessToken(userId); }
  catch { throw new HttpError("TOKEN_EXPIRED", 401, "Reconnect Google Classroom before importing this attachment."); }
  if (!classroomToken) throw new HttpError("CLASSROOM_NOT_CONNECTED", 404, "Connect Google Classroom before importing a course attachment.");
  const classroomAccount = await db.integrationAccount.findUnique({ where: { ownerId_provider: { ownerId: userId, provider: "classroom" } }, select: { scopes: true } });
  const grantedScopes = Array.isArray(classroomAccount?.scopes) ? classroomAccount.scopes.map(String) : [];
  if (!classroomToken.startsWith("mock_") && !grantedScopes.includes(CLASSROOM_MATERIALS_SCOPE)) {
    throw new HttpError("CLASSROOM_REAUTH_REQUIRED", 409, "Reconnect Google Classroom to grant read-only access to course materials.");
  }
  let materials;
  try { materials = await listClassroomMaterials(classroomToken); }
  catch { throw new HttpError("CLASSROOM_MATERIALS_FAILED", 502, "Could not verify that this file is attached to one of your Classroom courses. Refresh materials and retry.", true); }
  const material = materials.find((item) => item.driveFileId === parsed.data.driveFileId);
  if (!material) throw new HttpError("CLASSROOM_FILE_NOT_FOUND", 404, "This file is no longer listed in your Classroom materials. Refresh and try again.");
  const existing = await db.file.findFirst({ where: { ownerId: userId, sourceProvider: "classroom", sourceExternalId: parsed.data.driveFileId } });
  if (existing) return NextResponse.json({ file: existing, alreadyImported: true });
  const quota = await getQuota(userId, "files");
  if (!quota.allowed) throw new HttpError("QUOTA_EXCEEDED", 402, "File quota exceeded", false, { quota });
  let driveToken: string | null;
  try { driveToken = await getDriveAccessToken(userId); }
  catch { throw new HttpError("TOKEN_EXPIRED", 401, "Google Drive access expired. Reconnect Drive to import file contents."); }
  if (!driveToken) throw new HttpError("DRIVE_NOT_CONNECTED", 409, "Connect Google Drive separately to import file contents. Classroom materials can still be opened in Google.");
  let download;
  try { download = await downloadDriveFile(driveToken, parsed.data.driveFileId); }
  catch (error) { throw new HttpError("CLASSROOM_FILE_DOWNLOAD_FAILED", 502, error instanceof Error ? error.message : "Could not download this Classroom attachment."); }
  if (!ALLOWED.some((extension) => download.name.toLowerCase().endsWith(extension))) throw invalid("This attachment format is not supported yet. Import a PDF, TXT, MD, or DOCX file.");
  const key = storageKeyFor(userId, crypto.randomUUID(), download.name);
  await objectStorage.put(key, download.bytes, download.mimeType);
  let saved;
  try {
    saved = await db.file.create({ data: {
      ownerId: userId, name: download.name, mimeType: download.mimeType, size: download.bytes.length,
      status: "uploaded", textContent: "", storageKey: key, sourceProvider: "classroom", sourceExternalId: parsed.data.driveFileId,
      folder: `Classroom · ${material.courseName}`,
      tags: ["classroom", material.courseName].filter(Boolean),
    } });
  } catch (error) {
    await objectStorage.del(key).catch(() => undefined);
    const duplicate = await db.file.findFirst({ where: { ownerId: userId, sourceProvider: "classroom", sourceExternalId: parsed.data.driveFileId } });
    if (duplicate) return NextResponse.json({ file: duplicate, alreadyImported: true });
    throw error;
  }
  try { await enqueue("file.extract", { fileId: saved.id, ownerId: userId }, { idempotencyKey: `file.extract:${saved.id}` }); }
  catch { await db.file.update({ where: { id: saved.id }, data: { status: "failed", failureReason: "EXTRACT_FAILED" } }); }
  const final = await db.file.findUnique({ where: { id: saved.id } });
  return NextResponse.json({ file: final ?? saved, alreadyImported: false }, { status: 201 });
}, { rateLimit: { keyPrefix: "classroom-import", limit: 10 } });
