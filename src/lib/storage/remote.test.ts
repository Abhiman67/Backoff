import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

describe("configured object storage", () => {
  it("reads and deletes through the signed remote endpoint", async () => {
    vi.stubEnv("S3_BUCKET", "student-files");
    vi.stubEnv("S3_ENDPOINT", "https://objects.example.test");
    vi.stubEnv("S3_REGION", "us-east-1");
    vi.stubEnv("S3_ACCESS_KEY", "test-access");
    vi.stubEnv("S3_SECRET_KEY", "test-secret");
    const request = vi.fn(async (_url: URL, options: RequestInit) => options.method === "GET"
      ? new Response(new TextEncoder().encode("course notes")) : new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", request);
    const { objectStorage } = await import("./index");
    await objectStorage.put("user/file/notes.txt", new TextEncoder().encode("course notes"), "text/plain");
    expect(new TextDecoder().decode((await objectStorage.get("user/file/notes.txt"))!)).toBe("course notes");
    await objectStorage.del("user/file/notes.txt");
    expect(request.mock.calls.map(([, options]) => options.method)).toEqual(["PUT", "GET", "DELETE"]);
    expect((request.mock.calls[0][1].headers as Record<string, string>).authorization).toContain("AWS4-HMAC-SHA256");
  });

  it("does not silently write to local disk when the remote store fails", async () => {
    vi.stubEnv("S3_BUCKET", "student-files");
    vi.stubEnv("S3_ENDPOINT", "https://objects.example.test");
    vi.stubEnv("S3_ACCESS_KEY", "test-access");
    vi.stubEnv("S3_SECRET_KEY", "test-secret");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    const { objectStorage } = await import("./index");
    await expect(objectStorage.put("user/file/notes.txt", new TextEncoder().encode("notes"))).rejects.toThrow("S3 PUT failed");
  });
});
