import { db } from "@/lib/db";
import { connectProvider } from "./accounts";
import { decryptToken } from "./crypto";
import { refreshClassroomToken } from "./classroom-oauth";

export async function getClassroomAccessToken(ownerId: string): Promise<string | null> {
  let account = await db.integrationAccount.findUnique({
    where: { ownerId_provider: { ownerId, provider: "classroom" } },
  });
  if (!account?.accessTokenEncrypted) return null;
  if (!account.expiresAt || account.expiresAt.getTime() >= Date.now() + 60_000) {
    return decryptToken(account.accessTokenEncrypted);
  }
  if (!account.refreshTokenEncrypted) throw new Error("Classroom access expired. Reconnect to sync courses.");

  const refreshed = await refreshClassroomToken(decryptToken(account.refreshTokenEncrypted));
  account = await connectProvider(ownerId, "classroom", {
    scopes: Array.isArray(account.scopes) ? account.scopes.map(String) : [],
    accessToken: refreshed.accessToken,
    expiresInSec: refreshed.expiresIn,
  });
  if (!account.accessTokenEncrypted) throw new Error("Classroom token refresh failed. Reconnect to sync courses.");
  return decryptToken(account.accessTokenEncrypted);
}
