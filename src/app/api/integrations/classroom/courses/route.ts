import { NextResponse } from "next/server";
import { handleApi, HttpError } from "@/lib/api";
import { describeClassroomFailure, isMockToken, listClassroomCourses } from "@/lib/integrations/classroom";
import { getClassroomAccessToken } from "@/lib/integrations/classroom-token";
import { logError } from "@/lib/observability/logger";

export const GET = handleApi(async (_, { userId, requestId }) => {
  let token: string | null;
  try {
    token = await getClassroomAccessToken(userId);
  } catch {
    throw new HttpError("TOKEN_EXPIRED", 401, "Classroom access expired. Reconnect to sync courses.");
  }
  if (!token) throw new HttpError("CLASSROOM_NOT_CONNECTED", 404, "Google Classroom is not connected.");
  let courses;
  try {
    courses = await listClassroomCourses(token);
  } catch (error) {
    const failure = describeClassroomFailure(error);
    logError("classroom.courses.fetch_failed", { requestId, ...failure.details });
    throw new HttpError("CLASSROOM_SYNC_FAILED", 502, failure.message, true, failure.details);
  }
  return NextResponse.json({ courses, demo: isMockToken(token) }, { headers: { "Cache-Control": "no-store" } });
});
