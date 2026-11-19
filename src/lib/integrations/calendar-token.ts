import { db } from "@/lib/db";
import { connectProvider } from "./accounts";
import { decryptToken } from "./crypto";
import { refreshCalendarToken } from "./calendar-oauth";

export async function getCalendarAccessToken(ownerId: string): Promise<string | null> {
  let account = await db.integrationAccount.findUnique({ where: { ownerId_provider: { ownerId, provider: "calendar" } } });
  if (!account?.accessTokenEncrypted) return null;
  if (!account.expiresAt || account.expiresAt.getTime() >= Date.now() + 60_000) return decryptToken(account.accessTokenEncrypted);
  if (!account.refreshTokenEncrypted) throw new Error("Calendar access expired. Reconnect to continue.");
  const refreshed = await refreshCalendarToken(decryptToken(account.refreshTokenEncrypted));
  account = await connectProvider(ownerId, "calendar", {
    scopes: Array.isArray(account.scopes) ? account.scopes.map(String) : [],
    accessToken: refreshed.accessToken,
    expiresInSec: refreshed.expiresIn,
  });
  if (!account.accessTokenEncrypted) throw new Error("Calendar token refresh failed. Reconnect to continue.");
  return decryptToken(account.accessTokenEncrypted);
}
