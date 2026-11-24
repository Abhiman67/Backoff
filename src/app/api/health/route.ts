import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { Queue } from "bullmq";
import { QUEUE_NAME, getRedisUrl } from "@/lib/jobs/redis";

export async function GET() {
  const start = performance.now();
  let redis: { status: "connected" | "unavailable" | "not_configured"; latencyMs?: number } = {
    status: "not_configured",
  };
  try {
    await db.$queryRaw`SELECT 1`;
    const latencyMs = Math.round(performance.now() - start);

    if ((process.env.JOB_EXECUTION_MODE ?? "inline") === "redis") {
      const redisStart = performance.now();
      const queue = new Queue(QUEUE_NAME, {
        connection: { url: getRedisUrl(), lazyConnect: true, maxRetriesPerRequest: 1 },
      });
      try {
        await queue.waitUntilReady();
        redis = { status: "connected", latencyMs: Math.round(performance.now() - redisStart) };
      } catch {
        redis = {
          status: "unavailable",
          latencyMs: Math.round(performance.now() - redisStart),
        };
      } finally {
        await queue.close();
      }
    }

    const healthy = redis.status !== "unavailable";

    return NextResponse.json(
      {
        ok: healthy,
        service: "vidyasarthi",
        status: healthy ? "healthy" : "unhealthy",
        database: {
          status: "connected",
          latencyMs,
        },
        redis,
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      },
      { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    const latencyMs = Math.round(performance.now() - start);
    return NextResponse.json(
      {
        ok: false,
        service: "vidyasarthi",
        status: "unhealthy",
        database: {
          status: "unavailable",
          latencyMs,
        },
        redis,
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}

