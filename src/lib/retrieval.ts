import { db } from "@/lib/db";
import { chunkText, findRelevantChunks } from "@/lib/chunking";
import { cosineSimilarity, embedTexts } from "@/lib/embeddings";

type SourceFile = { id: string; name: string; textContent: string; createdAt: Date };
export type RetrievedChunk = { id: string; fileId: string; fileName: string; index: number; content: string; embedding: unknown };

export async function retrieveSourceChunks(ownerId: string, files: SourceFile[], query: string, limit = 5): Promise<RetrievedChunk[]> {
  if (!files.length || !query.trim()) return [];
  const stored = await db.fileChunk.findMany({ where: { ownerId, fileId: { in: files.map((file) => file.id) } }, take: 300 });
  const names = new Map(files.map((file) => [file.id, file.name]));
  const chunks: RetrievedChunk[] = stored.map((chunk) => ({ ...chunk, fileName: names.get(chunk.fileId) ?? "Source" }));
  const indexed = new Set(stored.map((chunk) => chunk.fileId));
  for (const file of files) {
    if (indexed.has(file.id) || !file.textContent) continue;
    for (const chunk of chunkText(file.textContent, 800, 120).slice(0, 20)) {
      chunks.push({ id: `${file.id}:${chunk.index}`, fileId: file.id, fileName: file.name, index: chunk.index, content: chunk.content, embedding: null });
    }
  }
  const terms = query.toLowerCase().split(/\W+/).filter((term) => term.length > 2);
  const lexical = (findRelevantChunks(query, chunks.map((chunk) => ({ ...chunk, tokenEstimate: chunk.content.length / 4 })), 10) as (RetrievedChunk & { tokenEstimate: number })[])
    .filter((chunk) => terms.some((term) => chunk.content.toLowerCase().includes(term)));
  let ranked: RetrievedChunk[] = lexical;
  if (chunks.some((chunk) => Array.isArray(chunk.embedding))) {
    try {
      const vector = (await embedTexts([query]))?.[0];
      if (vector) {
        const semantic = chunks.map((chunk) => ({ chunk, score: Array.isArray(chunk.embedding) ? cosineSimilarity(chunk.embedding as number[], vector) : 0 }))
          .filter(({ score }) => score >= 0.28).sort((a, b) => b.score - a.score).slice(0, limit).map(({ chunk }) => chunk);
        ranked = [...new Map([...semantic, ...lexical].map((chunk) => [chunk.id, chunk])).values()];
      }
    } catch {
      // A provider outage leaves exact text retrieval available.
    }
  }
  return ranked.slice(0, limit);
}
