import { NextResponse } from "next/server";
import { z } from "zod";
import { connectProvider, disconnectProvider } from "@/lib/integrations/accounts";
import { ADAPTERS } from "@/lib/integrations/mcp-client";
import { handleApi, HttpError, invalid } from "@/lib/api";

const connectSchema = z.object({
  scopes: z.array(z.string().max(80)).max(20).optional(),
  accessToken: z.string().trim().min(1).max(2000),
});

export const POST = handleApi<{ provider: string }>(async (req, { userId }, params) => {
  const { provider } = params;
  const normalizedProvider = provider.toLowerCase();
  if (["drive", "classroom", "calendar"].includes(normalizedProvider)) {
    throw new HttpError("OAUTH_REQUIRED", 501, "Use the provider's Google OAuth connect flow.");
  }
  if (!ADAPTERS[normalizedProvider]) throw new HttpError("UNKNOWN_PROVIDER", 400, "Unknown provider");
  const parsed = connectSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw invalid("Provide an access token and valid scopes.");
  const acct = await connectProvider(userId, provider, { scopes: parsed.data.scopes, accessToken: parsed.data.accessToken });
  const scopes = Array.isArray(acct.scopes) ? acct.scopes : [];
  return NextResponse.json({ account: { provider: acct.provider, scopes, updatedAt: acct.updatedAt } }, { status: 201 });
});

export const DELETE = handleApi<{ provider: string }>(async (_, { userId }, params) => {
  const { provider } = params;
  await disconnectProvider(userId, provider);
  return NextResponse.json({ ok: true });
});
