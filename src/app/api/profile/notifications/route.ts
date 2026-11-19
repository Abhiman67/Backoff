import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleApi, invalid } from "@/lib/api";

const preferenceSchema = z.object({
  classroom: z.boolean(),
  routines: z.boolean(),
  approvals: z.boolean(),
});

const defaultPreferences = { classroom: true, routines: true, approvals: true };

export const GET = handleApi(async (_, { userId }) => {
  const profile = await db.profile.findUnique({ where: { userId }, select: { notificationPreferences: true } });
  const parsed = preferenceSchema.safeParse(profile?.notificationPreferences);
  return NextResponse.json({ preferences: parsed.success ? parsed.data : defaultPreferences }, { headers: { "Cache-Control": "no-store" } });
});

export const PATCH = handleApi(async (request, { userId }) => {
  const parsed = preferenceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw invalid("Choose which in-app notifications you want to receive.");
  await db.profile.upsert({
    where: { userId },
    create: { userId, notificationPreferences: parsed.data },
    update: { notificationPreferences: parsed.data },
  });
  return NextResponse.json({ preferences: parsed.data });
});
