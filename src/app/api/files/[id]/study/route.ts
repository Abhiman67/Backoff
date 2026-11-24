import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { handleApi, HttpError, invalid, notFound } from "@/lib/api";
import { generateStudyMaterial } from "@/lib/ai-study";

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 20).slice(0, 30);
}

export const POST = handleApi<{ id: string }>(async (req, { userId }, params) => {
  const { id } = params;
  const file = await db.file.findFirst({ where: { id, ownerId: userId } });
  if (!file) throw notFound("File");
  const parsed = z.object({ action: z.enum(["summarize", "flashcards", "quiz"]) }).safeParse(await req.json());
  if (!parsed.success) throw invalid("Action must be summarize, flashcards, or quiz");
  const { action } = parsed.data;
  const sourceText = (file.textContent || "").trim();
  const sents = sentences(sourceText);
  if (sourceText.length < 20) return NextResponse.json({ summary: "Not enough text extracted yet. Upload a TXT or MD version for full study tools.", mode: "unavailable", source: { id: file.id, label: file.name } });
  try {
    const generated = await generateStudyMaterial({ action, sourceName: file.name, sourceText: sourceText.slice(0, 40_000) });
    if (generated) return NextResponse.json({ ...generated, source: { id: file.id, label: file.name }, mode: "ai" });
  } catch (cause) {
    const diagnostic = cause instanceof Error ? cause.message.slice(0, 180) : "Unknown provider error.";
    if (process.env.NODE_ENV !== "production") console.error("File study generation failed:", diagnostic);
    throw new HttpError("STUDY_GENERATION_FAILED", 502, process.env.NODE_ENV === "production" ? "Study material could not be generated right now. Please retry." : `Study material could not be generated. ${diagnostic}`);
  }
  const sourceSentences = sents.length > 0 ? sents : [sourceText.slice(0, 500)];
  if (action === "summarize") {
    return NextResponse.json({
      summary: sourceSentences.slice(0, 3).join(" "),
      points: sourceSentences.slice(0, 5),
      source: { id: file.id, label: file.name },
      mode: "extractive",
    });
  }
  if (action === "flashcards") {
    const cards = sourceSentences.slice(0, 6).map((t, i) => {
      const words = t.split(" ");
      const topic = words.slice(0, 4).join(" ");
      return {
        q: `Key concept ${i + 1}: ${topic}...?`,
        a: t,
      };
    });
    return NextResponse.json({ cards, source: { id: file.id, label: file.name }, mode: "extractive" });
  }
  const quiz = sourceSentences.slice(0, 4).map((t, i) => ({
    q: `Q${i + 1}: How does the note describe this concept: "${t.slice(0, 80)}..."?`,
    hint: `Review sentence ${i + 1} from your notes`,
    answer: t,
  }));
  return NextResponse.json({ quiz, source: { id: file.id, label: file.name }, mode: "extractive" });
}, { rateLimit: { keyPrefix: "file-study", limit: 12, windowSec: 60 } });
