import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import "@/lib/jobs/processors";
import { enqueue } from "@/lib/jobs/queue";

export const maxDuration = 120;

/**
 * Scheduler entrypoint. Gated by CRON_SECRET (never session auth — external
 * schedulers and the Redis worker have no user session).
 */
async function tick(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return apiError("SCHEDULER_NOT_CONFIGURED", "Set CRON_SECRET to enable scheduled ticks.", 501);
  const authorization = req.headers.get("authorization");
  const provided = req.headers.get("x-cron-secret") ?? (authorization?.startsWith("Bearer ") ? authorization.slice(7) : null);
  if (provided !== secret) return apiError("UNAUTHORIZED", "Invalid scheduler secret.", 401);
  const key = `responsibility.tick:${Math.floor(Date.now() / 60_000)}`;
  const result = await enqueue("responsibility.tick", {}, { idempotencyKey: key, maxRetries: 1 });
  return NextResponse.json({ ok: true, job: result }, { headers: { "Cache-Control": "no-store" } });
}

// Vercel Cron invokes scheduled routes with GET; POST remains for external schedulers.
export const GET = tick;
export const POST = tick;
