import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { handleApi, HttpError } from "@/lib/api";
import { CLASSROOM_OAUTH_STATE_COOKIE, classroomAuthUrl } from "@/lib/integrations/classroom-oauth";

export const GET = handleApi(async (_, { userId }) => {
  const state = randomUUID();
  try {
    const response = NextResponse.json({ authUrl: classroomAuthUrl(state) }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(CLASSROOM_OAUTH_STATE_COOKIE, `${userId}:${state}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/integrations/classroom/callback",
      maxAge: 600,
    });
    return response;
  } catch {
    throw new HttpError("OAUTH_NOT_CONFIGURED", 501, "Google Classroom OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
  }
});
