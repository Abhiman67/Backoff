import bcrypt from "bcryptjs";
import { afterEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/auth/password-reset/route";
import { db } from "@/lib/db";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("emails a link on the configured domain and accepts the reset token once", async () => {
  const email = "reset@test.local";
  const user = await db.user.create({ data: { email, name: "Reset test", passwordHash: "previous" } });
  vi.stubEnv("RESEND_API_KEY", "test-key");
  vi.stubEnv("EMAIL_FROM", "VidyaSarthi <support@test.local>");
  vi.stubEnv("NEXTAUTH_URL", "https://vidya.test.local");
  const resend = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ id: "simulated-email" }));
  vi.stubGlobal("fetch", resend);
  const request = (body: object) => POST(new Request("http://localhost/api/auth/password-reset", { method: "POST", body: JSON.stringify(body) }));
  expect((await request({ email })).status).toBe(200);
  expect(resend).toHaveBeenCalledTimes(1);
  expect(resend.mock.calls[0]?.[0]).toBe("https://api.resend.com/emails");
  const sent = JSON.parse(String(resend.mock.calls[0]?.[1].body));
  expect(sent.to).toEqual([email]);
  const link = new URL(sent.text.match(/https:\/\/\S+/)?.[0] ?? "");
  expect(link.origin).toBe("https://vidya.test.local");
  expect(link.pathname).toBe("/forgot-password");
  const token = link.searchParams.get("token");
  const password = "Fixture-only reset password!";
  const responses = await Promise.all([request({ token, password }), request({ token, password })]);
  expect(responses.map(({ status }) => status).sort()).toEqual([200, 400]);
  const saved = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(await bcrypt.compare(password, saved.passwordHash)).toBe(true);
});
