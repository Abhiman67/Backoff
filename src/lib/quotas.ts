import { db } from "@/lib/db";

// Centralized entitlement defaults. Replace the plan lookup with billing-backed
// entitlements when a payment provider is connected.
export const PLAN_LIMITS = {
  free: { messages: 100, files: 25 },
  pro: { messages: 2000, files: 500 },
} as const;

export async function getPlan(ownerId: string) {
  const subscription = await db.subscription.findUnique({ where: { userId: ownerId }, select: { plan: true, status: true } });
  return subscription?.status === "active" && subscription.plan === "pro" ? "pro" : "free";
}

export function quotaSummary(plan: keyof typeof PLAN_LIMITS, kind: "messages" | "files", used: number) {
  const limit = PLAN_LIMITS[plan][kind];
  return { plan, used, limit, remaining: Math.max(0, limit - used), allowed: used < limit };
}

export async function getQuota(ownerId: string, kind: "messages" | "files") {
  const [plan, used] = await Promise.all([getPlan(ownerId), kind === "messages"
    ? db.usageEvent.count({ where: { ownerId, type: "message" } })
    : db.file.count({ where: { ownerId, status: { not: "deleted" } } })]);
  return quotaSummary(plan, kind, used);
}
