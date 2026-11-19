import { db } from "@/lib/db";
import { connectProvider } from "./accounts";
import { decryptToken } from "./crypto";
import { refreshDriveToken } from "./drive";

export async function getDriveAccessToken(ownerId: string): Promise<string | null> {
  let account = await db.integrationAccount.findUnique({ where: { ownerId_provider: { ownerId, provider: "drive" } } });
  if (!account?.accessTokenEncrypted) return null;
  if (!account.expiresAt || account.expiresAt.getTime() >= Date.now() + 60_000) return decryptToken(account.accessTokenEncrypted);
  if (!account.refreshTokenEncrypted) throw new Error("Drive access expired. Reconnect to import files.");
  const refreshed = await refreshDriveToken(decryptToken(account.refreshTokenEncrypted));
  account = await connectProvider(ownerId, "drive", {
    scopes: Array.isArray(account.scopes) ? account.scopes.map(String) : [],
    accessToken: refreshed.accessToken,
    expiresInSec: refreshed.expiresIn,
  });
  if (!account.accessTokenEncrypted) throw new Error("Drive token refresh failed. Reconnect to import files.");
  return decryptToken(account.accessTokenEncrypted);
}
