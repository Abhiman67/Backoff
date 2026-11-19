import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
  NEXTAUTH_URL: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  JOB_EXECUTION_MODE: z.enum(["inline", "redis"]).optional(),
  REDIS_URL: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

export function getEnv(env: { [k: string]: string | undefined } = process.env): AppEnv {
  if (cached && env === process.env) return cached;
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  if (parsed.data.JOB_EXECUTION_MODE === "redis" && !parsed.data.REDIS_URL) {
    throw new Error("Invalid environment: JOB_EXECUTION_MODE=redis requires REDIS_URL");
  }
  if (env === process.env) cached = parsed.data;
  if (env.NODE_ENV === "production" && parsed.data.DATABASE_URL.startsWith("file:")) {
    throw new Error("Production requires a PostgreSQL DATABASE_URL; SQLite is not durable on serverless hosts.");
  }
  return parsed.data;
}

export function resetEnvCache(): void {
  cached = null;
}
