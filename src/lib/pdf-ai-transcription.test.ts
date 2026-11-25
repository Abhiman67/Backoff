import { afterEach, expect, it, vi } from "vitest";
import { transcribePdfWithAi } from "./pdf-ai-transcription";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("sends a scanned PDF as inline data and returns transcription", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("CHAT_AI_PROVIDER", "gemini");
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    expect(body.contents[0].parts[1].inline_data.mime_type).toBe("application/pdf");
    expect(body.contents[0].parts[1].inline_data.data).toBe(Buffer.from("%PDF-test").toString("base64"));
    return Response.json({ candidates: [{ content: { parts: [{ text: "Recursion needs a base case." }] } }] });
  });
  vi.stubGlobal("fetch", fetchMock);
  expect(await transcribePdfWithAi(new TextEncoder().encode("%PDF-test"))).toBe("Recursion needs a base case.");
  expect(fetchMock).toHaveBeenCalledOnce();
});
