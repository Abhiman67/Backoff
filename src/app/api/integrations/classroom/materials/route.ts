import { NextResponse } from "next/server";
import { handleApi, HttpError } from "@/lib/api";
import { fetchClassroomMaterials, describeClassroomFailure } from "@/lib/integrations/classroom";
import { getClassroomAccessToken } from "@/lib/integrations/classroom-token";
import { CLASSROOM_MATERIALS_SCOPE } from "@/lib/integrations/scopes";
import { db } from "@/lib/db";
import { logError } from "@/lib/observability/logger";

export const GET = handleApi(async (_, { userId, requestId }) => {
  let token: string | null;
  try {
    token = await getClassroomAccessToken(userId);
  } catch {
    throw new HttpError("TOKEN_EXPIRED", 401, "Classroom access expired. Reconnect Classroom to load course materials.");
  }
  if (!token) throw new HttpError("CLASSROOM_NOT_CONNECTED", 404, "Google Classroom is not connected.");
  const account = await db.integrationAccount.findUnique({ where: { ownerId_provider: { ownerId: userId, provider: "classroom" } }, select: { scopes: true } });
  const grantedScopes = Array.isArray(account?.scopes) ? account.scopes.map(String) : [];
  if (!grantedScopes.includes(CLASSROOM_MATERIALS_SCOPE) && !token.startsWith("mock_")) {
    throw new HttpError("CLASSROOM_REAUTH_REQUIRED", 409, "Reconnect Google Classroom to grant read-only access to course materials.");
  }
  try {
    const { materials, restrictedCourseCount } = await fetchClassroomMaterials(token);
    const importedFiles = await db.file.findMany({ where: { ownerId: userId, sourceProvider: "classroom", sourceExternalId: { not: null }, status: { not: "deleted" } }, select: { id: true, sourceExternalId: true, status: true, failureReason: true } });
    const importedDriveFileIds = importedFiles.filter((file) => file.status !== "failed").flatMap((file) => file.sourceExternalId ? [file.sourceExternalId] : []);
    return NextResponse.json({ materials, importedDriveFileIds, importedFiles: importedFiles.map((file) => ({ fileId: file.id, driveFileId: file.sourceExternalId, status: file.status, failureReason: file.failureReason })), restrictedCourseCount }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const failure = describeClassroomFailure(error);
    logError("classroom.materials.fetch_failed", { requestId, ...failure.details });
    throw new HttpError("CLASSROOM_MATERIALS_FAILED", 502, failure.message, true, failure.details);
  }
});
