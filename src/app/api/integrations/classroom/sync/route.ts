import { NextResponse } from "next/server";
import { handleApi, HttpError } from "@/lib/api";
import { syncClassroomTasks } from "@/lib/integrations/classroom-sync";
import { describeClassroomFailure } from "@/lib/integrations/classroom";
import { logError } from "@/lib/observability/logger";
import { db } from "@/lib/db";
import "@/lib/jobs/processors";

export const maxDuration = 120;

export const POST = handleApi(async (_, { userId, requestId }) => {
  try {
    return NextResponse.json(await syncClassroomTasks(userId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const failure = describeClassroomFailure(error);
    logError("classroom.tasks.sync_failed", { requestId, ...failure.details });
    await db.integrationAccount.updateMany({ where: { ownerId: userId, provider: "classroom" }, data: { lastSyncError: failure.message } });
    throw new HttpError("CLASSROOM_SYNC_FAILED", 502, failure.message, true, failure.details);
  }
});
