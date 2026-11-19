import { NextResponse } from "next/server";
import { disconnectProvider } from "@/lib/integrations/accounts";
import { handleApi, HttpError } from "@/lib/api";

export const POST = handleApi(async () => {
  throw new HttpError("OAUTH_REQUIRED", 501, "Use the Google OAuth connect flow to link Classroom.");
});

export const DELETE = handleApi(async (_, { userId }) => {
  await disconnectProvider(userId, "classroom");
  return NextResponse.json({ ok: true });
});
