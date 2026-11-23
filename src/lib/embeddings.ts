import { z } from "zod";

const embeddingResponse = z.object({ data: z.array(z.object({ index: z.number(), embedding: z.array(z.number()) })) });

export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || texts.length === 0) return null;
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts, encoding_format: "float" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Embedding request failed (${response.status}).`);
  const parsed = embeddingResponse.parse(await response.json());
  const ordered = parsed.data.sort((a, b) => a.index - b.index).map((entry) => entry.embedding);
  if (ordered.length !== texts.length || ordered.some((entry) => entry.length === 0)) throw new Error("Embedding response was incomplete.");
  return ordered;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aNorm += a[i] * a[i];
    bNorm += b[i] * b[i];
  }
  return dot / (Math.sqrt(aNorm * bNorm) || 1);
}
