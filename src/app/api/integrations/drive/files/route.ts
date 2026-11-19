import { NextResponse } from "next/server";
import { listDriveFiles } from "@/lib/integrations/drive";
import { getDriveAccessToken } from "@/lib/integrations/drive-token";
import { handleApi, HttpError } from "@/lib/api";

export const GET = handleApi(async (_, { userId: ownerId }) => {
  let token: string | null;
  try {
    token = await getDriveAccessToken(ownerId);
  } catch {
    throw new HttpError("TOKEN_EXPIRED", 401, "Drive access expired. Reconnect to import files.");
  }
  if (!token) throw new HttpError("DRIVE_NOT_CONNECTED", 404, "Drive not connected.");
  try {
    const files = await listDriveFiles(token);
    return NextResponse.json({ files }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    throw new HttpError("DRIVE_LIST_FAILED", 502, "Google Drive could not be reached. Try again.");
  }
});
