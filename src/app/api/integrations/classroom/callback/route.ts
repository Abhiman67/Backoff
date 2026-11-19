import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { handleApi, HttpError, invalid } from "@/lib/api";
import { connectProvider } from "@/lib/integrations/accounts";
import { CLASSROOM_OAUTH_STATE_COOKIE, exchangeClassroomCode } from "@/lib/integrations/classroom-oauth";
import { MIN_SCOPES } from "@/lib/integrations/scopes";

export const GET = handleApi(async (request, { userId }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(CLASSROOM_OAUTH_STATE_COOKIE)?.value;
  const response = NextResponse.redirect(new URL("/app/settings/integrations?connected=classroom", request.url));
  response.cookies.set(CLASSROOM_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/integrations/classroom/callback",
    maxAge: 0,
  });
  if (!code) throw invalid("Google did not return an authorization code.");
  if (!returnedState || expectedState !== `${userId}:${returnedState}`) {
    throw new HttpError("OAUTH_STATE_INVALID", 400, "Google sign-in expired or could not be verified. Please connect again.");
  }
  try {
    const tokens = await exchangeClassroomCode(code);
    await connectProvider(userId, "classroom", {
      scopes: MIN_SCOPES.classroom,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSec: tokens.expiresIn,
    });
  } catch {
    throw new HttpError("OAUTH_FAILED", 502, "Google Classroom authorization failed. Please try connecting again.");
  }
  return response;
});
