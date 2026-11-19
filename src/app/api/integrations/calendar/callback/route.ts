import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { handleApi, HttpError, invalid } from "@/lib/api";
import { connectProvider } from "@/lib/integrations/accounts";
import { exchangeCalendarCode } from "@/lib/integrations/calendar-oauth";
import { MIN_SCOPES } from "@/lib/integrations/scopes";

export const GET = handleApi(async (request, { userId }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("backoff_calendar_oauth_state")?.value;
  if (!code) throw invalid("Google did not return an authorization code.");
  if (!returnedState || expectedState !== `${userId}:${returnedState}`) {
    throw new HttpError("OAUTH_STATE_INVALID", 400, "Google sign-in expired or could not be verified. Please connect again.");
  }
  try {
    const tokens = await exchangeCalendarCode(code);
    await connectProvider(userId, "calendar", {
      scopes: MIN_SCOPES.calendar,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSec: tokens.expiresIn,
    });
  } catch {
    throw new HttpError("OAUTH_FAILED", 502, "Google Calendar authorization failed. Please try connecting again.");
  }
  const response = NextResponse.redirect(new URL("/app/settings/integrations?connected=calendar", request.url));
  response.cookies.set("backoff_calendar_oauth_state", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/integrations/calendar/callback",
    maxAge: 0,
  });
  return response;
});
