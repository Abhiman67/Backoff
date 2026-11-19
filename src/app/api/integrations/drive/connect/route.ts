import { NextResponse } from "next/server";
import { getDriveAuthUrl } from "@/lib/integrations/drive";
import { randomUUID } from "node:crypto";
import { handleApi, HttpError } from "@/lib/api";

// Step 1 of Drive OAuth: returns the Google consent URL (minimum scope).
export const GET = handleApi(async (_, { userId }) => {
  const state = randomUUID();
  try {
    const response = NextResponse.json({ authUrl: getDriveAuthUrl(state) }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set("backoff_drive_oauth_state", `${userId}:${state}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/integrations/drive/callback",
      maxAge: 600,
    });
    return response;
  } catch {
    throw new HttpError("OAUTH_NOT_CONFIGURED", 501, "Google OAuth is not configured.");
  }
});
