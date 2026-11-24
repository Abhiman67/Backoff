import { defineConfig } from "vitest/config";
import path from "path";

// Integration config: runs ONLY DB-backed workflow tests.
// The DATABASE_URL env var must point at a temp database (see scripts/test-integration.sh).
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { env: { CHAT_AI_PROVIDER: "mock", OPENAI_API_KEY: "", GEMINI_API_KEY: "", ALLOW_MOCK_AI: "true" }, include: ["src/**/*.integration.test.ts"], testTimeout: 30000 },
});
