import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { handleApi, HttpError } from "@/lib/api";
import { calendarAuthUrl } from "@/lib/integrations/calendar-oauth";

export const GET = handleApi(async (_, { userId }) => {
  const state = randomUUID();
  try {
    const response = NextResponse.json({ authUrl: calendarAuthUrl(state) }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set("backoff_calendar_oauth_state", `${userId}:${state}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/integrations/calendar/callback",
      maxAge: 600,
    });
    return response;
  } catch {
    throw new HttpError("OAUTH_NOT_CONFIGURED", 501, "Google Calendar OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
  }
});
