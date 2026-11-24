import { z } from "zod";
import { PLATFORM_SYSTEM_POLICY, streamAi } from "@/lib/ai";
import { db } from "@/lib/db";
import { createTaskInputSchema } from "@/lib/tools/internal/tasks";
import { buildBoundedContext, renderContextText } from "./context";
import { buildPlan } from "./planner";
import type { PlanStep } from "./types";

const proposal = z.object({
  finding: z.string().trim().min(1).max(600),
  task: z.unknown().optional(),
});
const suggestedTask = createTaskInputSchema.pick({ title: true, priority: true });

export async function planWorkspaceRun(input: {
  userId: string;
  agentId: string;
  currentGoal: string;
  conversationId?: string;
  projectId?: string;
  fileIds: string[];
  canProposeTask: boolean;
}): Promise<PlanStep[]> {
  const [context, tasks] = await Promise.all([
    buildBoundedContext(input),
    db.task.findMany({
      where: { ownerId: input.userId, dueDate: { not: null }, status: { notIn: ["done", "completed", "cancelled"] } },
      orderBy: { dueDate: "asc" },
      take: 15,
      select: { title: true, dueDate: true, externalProvider: true, status: true },
    }),
  ]);
  let reply = "";
  for await (const event of streamAi({
    system: PLATFORM_SYSTEM_POLICY + `
For this run return ONLY JSON {"finding":"short result","task":null} or
{"finding":"short result","task":{"title":"concrete next step","priority":"medium"}}.
The JSON contract replaces the response footer. Use the workspace evidence.
Name the relevant task or file when available. Say when evidence is missing.
Suggest a new planner task only if it adds value and is distinct from existing work.
${input.canProposeTask ? "The application may ask the student to approve a task." : "Return task:null. This run reports suggestions only."}`,
    message: input.currentGoal,
    output: { kind: "workspace_plan" },
    context: JSON.stringify({
      date: new Date().toISOString(),
      role: context.agent,
      history: context.recentMessages.slice(-6),
      workspace: renderContextText(context),
      openDatedTasks: tasks.map(task => ({ ...task, title: task.title.slice(0, 200) })),
    }),
    history: [],
  })) {
    if (event.type === "error") throw new Error(event.message);
    if (event.type === "done" && event.messageId === "mock-workspace-plan" && input.canProposeTask) return buildPlan(input.currentGoal);
    if (event.type === "message_delta") reply += event.text;
    if (reply.length > 4000) throw new Error("The agent plan exceeded its response limit.");
  }
  let raw: unknown;
  try { raw = JSON.parse(reply.trim().replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/gi, "")); }
  catch { throw new Error("The AI provider returned a plan that was not valid JSON."); }
  const parsed = proposal.safeParse(raw);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => `${issue.path.join(".") || "response"}:${issue.code}`).join(", ");
    const shape = raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? Object.entries(raw).map(([key, value]) => `${key}:${Array.isArray(value) ? "array" : value === null ? "null" : typeof value}`).join(", ")
      : Array.isArray(raw) ? "array" : typeof raw;
    throw new Error(`The AI provider returned an invalid plan (${fields || "unexpected format"}; received ${shape}).`);
  }
  const taskResult = parsed.data.task == null ? null : suggestedTask.safeParse(parsed.data.task);
  const task = taskResult?.success ? taskResult.data : null;
  const { finding } = parsed.data;
  const steps: PlanStep[] = [{ kind: "draft", title: "Workspace findings", description: finding, requiresApproval: false }];
  if (input.canProposeTask && task) {
    steps.push({
      kind: "tool", title: "Add a planner task", description: `${task.title}\n\n${finding}`,
      requiresApproval: true, toolName: "create_task", input: { ...task, projectId: input.projectId },
    });
  }
  return steps;
}

export async function workspaceRunFinding(runId: string) {
  const step = await db.agentStep.findFirst({
    where: { runId, kind: "draft", title: "Workspace findings", status: "completed" },
    select: { description: true },
  });
  return step?.description;
}
