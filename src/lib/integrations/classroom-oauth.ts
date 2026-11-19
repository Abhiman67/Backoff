import { MIN_SCOPES } from "./scopes";
import { z } from "zod";

function credentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth is not configured.");
  return { clientId, clientSecret };
}

export const CLASSROOM_OAUTH_STATE_COOKIE = "backoff_classroom_oauth_state";

export function classroomRedirectUri() {
  return `${(process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/integrations/classroom/callback`;
}

export function classroomAuthUrl(state: string) {
  const { clientId } = credentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: classroomRedirectUri(),
    response_type: "code",
    scope: MIN_SCOPES.classroom.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeClassroomCode(code: string) {
  const { clientId, clientSecret } = credentials();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: classroomRedirectUri(),
        grant_type: "authorization_code",
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Google token exchange failed.");
    const result = z.object({ access_token: z.string(), refresh_token: z.string().optional(), expires_in: z.number().optional() }).parse(await response.json());
    return { accessToken: result.access_token, refreshToken: result.refresh_token, expiresIn: result.expires_in };
  } finally {
    clearTimeout(timer);
  }
}

export async function refreshClassroomToken(refreshToken: string) {
  const { clientId, clientSecret } = credentials();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Google token refresh failed.");
    const result = z.object({ access_token: z.string(), expires_in: z.number().optional() }).parse(await response.json());
    return { accessToken: result.access_token, expiresIn: result.expires_in };
  } finally {
    clearTimeout(timer);
  }
}
