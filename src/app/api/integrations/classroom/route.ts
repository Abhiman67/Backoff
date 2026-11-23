import { NextResponse } from "next/server";
import { disconnectProvider } from "@/lib/integrations/accounts";
import { z } from "zod";
import { handleApi, HttpError, invalid, notFound } from "@/lib/api";
import { db } from "@/lib/db";

export const GET = handleApi(async (_, { userId }) => {
  const account = await db.integrationAccount.findUnique({ where: { ownerId_provider: { ownerId: userId, provider: "classroom" } }, select: { lastSyncedAt: true, lastSyncError: true } });
  return NextResponse.json({ connected: Boolean(account), lastSyncedAt: account?.lastSyncedAt ?? null, lastSyncError: account?.lastSyncError ?? null }, { headers: { "Cache-Control": "no-store" } });
});

export const PATCH = handleApi(async (req, { userId }) => {
  const settings = z.object({ autoImportAttachments: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!settings.success) throw invalid("Choose whether to import Classroom attachments automatically.");
  const { autoImportAttachments } = settings.data;
  if (autoImportAttachments) {
    const drive = await db.integrationAccount.findFirst({
      where: { ownerId: userId, provider: "drive", accessTokenEncrypted: { not: null } },
      select: { id: true },
    });
    if (!drive) throw new HttpError("DRIVE_NOT_CONNECTED", 409, "Connect Google Drive before enabling automatic import.");
  }
  const updated = await db.integrationAccount.updateMany({
    where: { ownerId: userId, provider: "classroom", accessTokenEncrypted: { not: null } },
    data: { autoImportAttachments },
  });
  if (!updated.count) throw notFound("Classroom connection");
  return NextResponse.json({ autoImportAttachments });
});

export const POST = handleApi(async () => {
  throw new HttpError("OAUTH_REQUIRED", 501, "Use the Google OAuth connect flow to link Classroom.");
});

export const DELETE = handleApi(async (_, { userId }) => {
  await disconnectProvider(userId, "classroom");
  return NextResponse.json({ ok: true });
});
