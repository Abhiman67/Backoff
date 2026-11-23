import { NextResponse } from "next/server";
import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { sendPasswordResetEmail } from "@/lib/email";
import { logError } from "@/lib/observability/logger";
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const requestSchema = z.object({ email: z.string().email().max(255) });
const resetSchema = z.object({ token: z.string().min(32).max(200), password: z.string().min(8).max(128) });
export async function POST(req: Request) {
  const body: unknown = await req.json().catch(() => null);
  const request = requestSchema.safeParse(body);
  if (request.success) {
    const user = await db.user.findFirst({
      where: { email: request.data.email.toLowerCase(), passwordHash: { not: "" } },
      select: { id: true },
    });
    if (user) {
      await db.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
      const token = randomBytes(32).toString("hex");
      await db.passwordResetToken.create({ data: { userId: user.id, tokenHash: hash(token), expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
      await audit(user.id, "password_reset_requested");
      const origin = new URL(process.env.NEXTAUTH_URL ?? req.url).origin;
      const sent = await sendPasswordResetEmail(request.data.email.toLowerCase(), token, origin).catch(() => false);
      if (!sent) logError("password_reset.delivery_unavailable");
      if (!sent && process.env.NODE_ENV !== "production") return NextResponse.json({ ok: true, devToken: token });
    }
    return NextResponse.json({ ok: true });
  }
  const reset = resetSchema.safeParse(body);
  if (!reset.success) return NextResponse.json({ error: "Invalid reset request" }, { status: 400 });
  const record = await db.passwordResetToken.findUnique({ where: { tokenHash: hash(reset.data.token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) return NextResponse.json({ error: "Invalid or expired token" }, { status: 400 });
  const passwordHash = await bcrypt.hash(reset.data.password, 12);
  const consumed = await db.$transaction(async (transaction) => {
    const now = new Date();
    const claimed = await transaction.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now },
    });
    if (!claimed.count) return false;
    await transaction.user.update({ where: { id: record.userId }, data: { passwordHash } });
    return true;
  });
  if (!consumed) return NextResponse.json({ error: "Invalid or expired token" }, { status: 400 });
  await audit(record.userId, "password_reset_completed");
  return NextResponse.json({ ok: true });
}
