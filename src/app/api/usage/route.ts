import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUsage } from "@/lib/usage";
import { getPlan, quotaSummary } from "@/lib/quotas";
import { handleApi, HttpError, invalid } from "@/lib/api";

export const GET = handleApi(async (_req, { userId }) => {
  const [usage, plan, agents] = await Promise.all([
    getUsage(userId), getPlan(userId), db.agent.count({ where: { ownerId: userId } }),
  ]);
  const messageQuota = quotaSummary(plan, "messages", usage.byType.message ?? 0);
  const fileQuota = quotaSummary(plan, "files", usage.files);
  return NextResponse.json({
    plan: messageQuota.plan === "pro" ? "Student Pro" : "Starter",
    agents,
    ...usage,
    limits: { agents: "unlimited", messages: messageQuota, files: fileQuota },
  });
});

export const POST = handleApi(async (req, { userId }) => {
  let type: unknown;
  try {
    ({ type } = await req.json());
  } catch {
    throw new HttpError("USAGE_TRACK_FAILED", 500, "Failed to log event");
  }
  if (!type || typeof type !== "string") {
    throw invalid("Invalid type");
  }
  try {
    const { trackUsage } = await import("@/lib/usage");
    await trackUsage(userId, (type as string).slice(0, 50));
  } catch {
    throw new HttpError("USAGE_TRACK_FAILED", 500, "Failed to log event");
  }
  return NextResponse.json({ ok: true });
});
