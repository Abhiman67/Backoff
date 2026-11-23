import { describe, expect, it, afterEach, vi } from "vitest";
import { getEnv, resetEnvCache } from "./env";
import { HttpError, invalid, notFound, unauthorized } from "./http-error";

describe("env validation", () => {
  afterEach(() => { resetEnvCache(); vi.unstubAllEnvs(); });
  it("accepts a minimal valid env", () => {
    expect(getEnv({ DATABASE_URL: "file:./dev.db", AUTH_SECRET: "secret" }).DATABASE_URL).toBe("file:./dev.db");
  });
  it("rejects missing required vars", () => {
    expect(() => getEnv({})).toThrow("Invalid environment");
  });
  it("rejects redis mode without REDIS_URL", () => {
    expect(() => getEnv({ DATABASE_URL: "x", AUTH_SECRET: "y", JOB_EXECUTION_MODE: "redis" })).toThrow("REDIS_URL");
  });
  it("keeps rejecting SQLite in production after repeated reads", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "file:./dev.db");
    vi.stubEnv("AUTH_SECRET", "secret");
    expect(() => getEnv()).toThrow("Production requires a PostgreSQL DATABASE_URL");
    expect(() => getEnv()).toThrow("Production requires a PostgreSQL DATABASE_URL");
  });
});

describe("HttpError helpers", () => {
  it("builds standard errors", () => {
    expect(unauthorized().status).toBe(401);
    expect(notFound("Task").message).toContain("Task");
    expect(invalid().code).toBe("INVALID_INPUT");
    expect(new HttpError("X", 500, "boom").retryable).toBe(false);
  });
});
