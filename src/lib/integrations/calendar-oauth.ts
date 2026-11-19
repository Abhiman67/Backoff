import { z } from "zod";
import { MIN_SCOPES } from "./scopes";

function credentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth is not configured.");
  return { clientId, clientSecret };
}

export function calendarRedirectUri() {
  return `${(process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/integrations/calendar/callback`;
}

export function calendarAuthUrl(state: string) {
  const { clientId } = credentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: calendarRedirectUri(),
    response_type: "code",
    scope: MIN_SCOPES.calendar.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function postToken(body: URLSearchParams) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Google token request failed.");
    return z.object({ access_token: z.string(), refresh_token: z.string().optional(), expires_in: z.number().optional() }).parse(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

export async function exchangeCalendarCode(code: string) {
  const { clientId, clientSecret } = credentials();
  const token = await postToken(new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: calendarRedirectUri(),
    grant_type: "authorization_code",
  }));
  return { accessToken: token.access_token, refreshToken: token.refresh_token, expiresIn: token.expires_in };
}

export async function refreshCalendarToken(refreshToken: string) {
  const { clientId, clientSecret } = credentials();
  const token = await postToken(new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  }));
  return { accessToken: token.access_token, expiresIn: token.expires_in };
}
