import { createCanvas } from "@napi-rs/canvas";
import { deflateSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { GET as tick } from "@/app/api/responsibilities/tick/route";
import { queueChatTurn } from "@/lib/agents/chat-turn";
import { decideApproval } from "@/lib/approvals-decide";
import { dispatchChatTurn } from "@/lib/jobs/queue";
import { REPLY_SOURCES_ROLE } from "@/lib/reply-sources";
import { studyCoachThreadId } from "@/lib/study-coach-thread";
import { connectProvider } from "./accounts";
import { syncClassroomTasks } from "./classroom-sync";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function scannedPdf() {
  const canvas = createCanvas(800, 140);
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000";
  context.font = "40px sans-serif";
  context.fillText("Recursion needs a base case.", 32, 84);
  const image = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const gray = Buffer.from(image.filter((_, index) => index % 4 === 0));
  const pixels = deflateSync(gray);
  const stream = Buffer.from("q 800 0 0 140 0 0 cm /Scan Do Q");
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 140] /Resources << /XObject << /Scan 5 0 R >> >> /Contents 4 0 R >>"),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from("\nendstream")]),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 800 /Height 140 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${pixels.length} >>\nstream\n`), pixels, Buffer.from("\nendstream")]),
  ];
  let pdf = Buffer.from("%PDF-1.4\n");
  const entries = ["0000000000 65535 f "];
  for (const [index, object] of objects.entries()) {
    entries.push(`${String(pdf.length).padStart(10, "0")} 00000 n `);
    pdf = Buffer.concat([pdf, Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]);
  }
  return Buffer.concat([pdf, Buffer.from(`xref\n0 ${entries.length}\n${entries.join("\n")}\ntrailer\n<< /Size ${entries.length} /Root 1 0 R >>\nstartxref\n${pdf.length}\n%%EOF\n`)]);
}

it("imports scanned coursework through the scheduler, cites it, and creates tasks once", async () => {
  vi.stubEnv("CRON_SECRET", "local-cron-test");
  vi.stubEnv("JOB_EXECUTION_MODE", "inline");
  vi.stubEnv("CHAT_AI_PROVIDER", "gemini");
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("EMBEDDINGS_PROVIDER", "");
  const user = await db.user.create({ data: { name: "OCR student", email: "classroom-ocr@test.local", passwordHash: "test" } });
  await connectProvider(user.id, "classroom", { accessToken: "classroom-fixture-token", expiresInSec: 3600 });
  await connectProvider(user.id, "drive", { accessToken: "drive-fixture-token", expiresInSec: 3600 });
  const pdf = scannedPdf();
  const sessions = ["Read the brief", "Trace recursion", "Check the base case"];
  const requests: string[] = [];
  let downloads = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    const path = url.pathname;
    if (path === "/v1/courses") return Response.json({ courses: [{ id: "course", name: "Programming" }] });
    if (path.endsWith("/courseWork")) return Response.json({ courseWork: [{
      id: "recursion", title: "Recursion exercise", materials: [{ driveFile: { driveFile: { id: "scan", title: "Scanned brief.pdf" } } }],
    }] });
    if (path.endsWith("/studentSubmissions")) return Response.json({});
    if (path === "/drive/v3/files/scan") {
      if (!url.searchParams.has("alt")) return Response.json({ id: "scan", name: "Scanned brief.pdf", mimeType: "application/pdf", size: String(pdf.length) });
      downloads += 1;
      return new Response(Uint8Array.from(pdf));
    }
    if (url.hostname === "generativelanguage.googleapis.com" && path.includes("streamGenerateContent")) {
      requests.push(String(init?.body));
      const text = requests.length === 1 ? "Start with the base case." : JSON.stringify({ sessions });
      return new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`);
    }
    throw new Error(`Unexpected external request: ${path}`);
  }));
  await syncClassroomTasks(user.id);
  expect(downloads).toBe(0);
  await db.integrationAccount.update({
    where: { ownerId_provider: { ownerId: user.id, provider: "classroom" } },
    data: { autoImportAttachments: true },
  });
  const request = new Request("http://localhost/api/responsibilities/tick", { headers: { Authorization: "Bearer local-cron-test" } });
  expect(await (await tick(request)).json()).toMatchObject({ ok: true, job: { status: "completed" } });
  await syncClassroomTasks(user.id);
  expect(downloads).toBe(1);

  const assignment = await db.task.findFirstOrThrow({ where: { ownerId: user.id, externalProvider: "classroom" } });
  const attachments = await db.classroomAttachment.findMany({ where: { taskId: assignment.id }, include: { file: true } });
  expect(attachments).toHaveLength(1);
  const file = attachments[0]?.file;
  expect(file).toMatchObject({ name: "Scanned brief.pdf", status: "ready" });
  expect(file?.textContent).toContain("Recursion needs a base case");
  expect(await db.file.count({ where: { ownerId: user.id } })).toBe(1);

  const coach = await db.agent.findFirstOrThrow({ where: { ownerId: user.id, template: "study-coach" } });
  const conversationId = studyCoachThreadId(coach.id);
  const base = { userId: user.id, conversationId };
  await dispatchChatTurn(await queueChatTurn({ ...base, turnId: crypto.randomUUID(), request: { kind: "chat", message: "Explain recursion", assignmentId: assignment.id } }));
  expect(requests[0]).toContain("Recursion needs a base case");
  const citation = await db.message.findFirstOrThrow({ where: { conversationId, role: REPLY_SOURCES_ROLE } });
  expect(JSON.parse(citation.content)).toEqual([{ id: file?.id, label: "Scanned brief.pdf" }]);

  await dispatchChatTurn(await queueChatTurn({ ...base, turnId: crypto.randomUUID(), request: { kind: "study_plan", assignmentId: assignment.id } }));
  const taskQuery = { where: { ownerId: user.id, agentId: coach.id } };
  expect(await db.task.count(taskQuery)).toBe(0);
  const approvalId = `study-plan-${assignment.id}`;
  const decisions = await Promise.allSettled([decideApproval(user.id, approvalId, "approve"), decideApproval(user.id, approvalId, "approve")]);
  expect(decisions.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
  expect(await db.task.count(taskQuery)).toBe(3);
});
