import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleApi, HttpError, invalid } from "@/lib/api";
import { getClassroomAccessToken } from "@/lib/integrations/classroom-token";
import { fetchClassroomMaterials } from "@/lib/integrations/classroom";
import "@/lib/jobs/processors";
import { importClassroomFile } from "@/lib/integrations/classroom-import";
import { CLASSROOM_MATERIALS_SCOPE } from "@/lib/integrations/scopes";

const bodySchema = z.object({ driveFileId: z.string().min(1).max(256) });

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
  let materialResult;
  try { materialResult = await fetchClassroomMaterials(classroomToken); }
  catch { throw new HttpError("CLASSROOM_MATERIALS_FAILED", 502, "Could not verify that this file is attached to one of your Classroom courses. Refresh materials and retry.", true); }
  const material = materialResult.materials.find((item) => item.driveFileId === parsed.data.driveFileId);
  if (!material) throw new HttpError("CLASSROOM_FILE_NOT_FOUND", materialResult.restrictedCourseCount ? 403 : 404, materialResult.restrictedCourseCount ? "Google denied access to some course materials. Ask your college administrator to allow Classroom API material access, then retry." : "This file is no longer listed in your Classroom materials. Refresh and try again.");
  const { file, alreadyImported } = await importClassroomFile({ userId, driveFileId: parsed.data.driveFileId, material });
  return NextResponse.json({ file, alreadyImported }, { status: alreadyImported ? 200 : 201 });
}, { rateLimit: { keyPrefix: "classroom-import", limit: 10 } });
