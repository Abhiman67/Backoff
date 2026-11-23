import { z } from "zod";

export const practiceQuestionSchema = z.object({
  id: z.string(), q: z.string(), hint: z.string(), answer: z.string(), concept: z.string(),
  fileId: z.string(), fileName: z.string(), chunkIndex: z.number().int(), excerpt: z.string(),
});

export type PracticeQuestion = z.infer<typeof practiceQuestionSchema>;

export function sourceIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function practiceQuestions(value: unknown): PracticeQuestion[] {
  const parsed = z.array(practiceQuestionSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}
