import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeDriveCode } from "@/lib/integrations/drive";
import { connectProvider } from "@/lib/integrations/accounts";
import { MIN_SCOPES } from "@/lib/integrations/scopes";
import { handleApi, HttpError, invalid } from "@/lib/api";

// Step 2 of Drive OAuth: exchanges the code, stores encrypted tokens.
export const GET = handleApi(async (req, { userId }) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("backoff_drive_oauth_state")?.value;
  if (!code) throw invalid("Missing code.");
  if (!returnedState || expectedState !== `${userId}:${returnedState}`) {
    throw new HttpError("OAUTH_STATE_INVALID", 400, "Google sign-in expired or could not be verified. Please connect again.");
  }
  try {
    const tokens = await exchangeDriveCode(code);
    await connectProvider(userId, "drive", {
      scopes: MIN_SCOPES.drive,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSec: tokens.expiresIn,
    });
  } catch {
    throw new HttpError("OAUTH_FAILED", 502, "Google OAuth failed or is not configured.");
  }
  const response = NextResponse.redirect(new URL("/app/settings/integrations?connected=drive", req.url));
  response.cookies.set("backoff_drive_oauth_state", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/integrations/drive/callback",
    maxAge: 0,
  });
  return response;
});
