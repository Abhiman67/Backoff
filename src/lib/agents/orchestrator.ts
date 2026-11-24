import { db } from "@/lib/db";
import { assertRunTransition } from "./state-machine";
import { z } from "zod";
import { planWorkspaceRun } from "./workspace-plan";
import { getTool } from "@/lib/tools/registry";
import { requiresApproval } from "@/lib/tools/permissions";
import { APPROVAL_TTL_MS } from "@/lib/approvals";
import { audit } from "@/lib/audit";
import { trackUsage } from "@/lib/usage";
import { logError, logInfo } from "@/lib/observability/logger";
import { startTrace } from "@/lib/observability/tracing";
import { captureError } from "@/lib/observability/sentry";
import type { AgentRunRequest, AgentRunStatus } from "./types";

async function setRunStatus(runId: string, from: AgentRunStatus, to: AgentRunStatus, extra: Record<string, unknown> = {}) {
  assertRunTransition(from, to);
  const { logInfo } = await import("@/lib/observability/logger");
  logInfo("run.transition", { runId, from, to });
  return db.agentRun.update({ where: { id: runId }, data: { status: to, ...extra } });
}

export async function createRun(ownerId: string, req: AgentRunRequest) {
  const goal = req.goal.trim().slice(0, 1000);
  if (!goal) throw new Error("Empty goal");
  const agent = await db.agent.findFirst({ where: { id: req.agentId, ownerId }, select: { id: true } });
  if (!agent) throw new Error("Agent not found");
  if (req.projectId) {
    const p = await db.project.findFirst({ where: { id: req.projectId, ownerId }, select: { id: true } });
    if (!p) throw new Error("Project not found");
  }
  if (req.conversationId) {
    const c = await db.conversation.findFirst({ where: { id: req.conversationId, userId: ownerId }, select: { id: true } });
    if (!c) throw new Error("Conversation not found");
  }
  if (req.contextFileIds?.length) {
    const count = await db.file.count({ where: { id: { in: req.contextFileIds }, ownerId } });
    if (count !== new Set(req.contextFileIds).size) throw new Error("File not authorized");
  }
  const run = await db.agentRun.create({
    data: {
      ownerId,
      agentId: req.agentId,
      goal,
      status: "queued",
      conversationId: req.conversationId,
      projectId: req.projectId,
      metadata: JSON.stringify({ contextFileIds: req.contextFileIds ?? [], routine: req.routine }),
    },
  });
  await trackUsage(ownerId, "agent_run_created");
  return run;
}

export async function planRun(runId: string, ownerId: string) {
  const run = await db.agentRun.findFirst({ where: { id: runId, ownerId } });
  if (!run) throw new Error("Run not found");
  // Idempotent: never duplicate steps if planning retried or resumed.
  const existingSteps = await db.agentStep.findMany({ where: { runId }, orderBy: { sequence: "asc" } });
  if (existingSteps.length > 0) {
    await db.agentRun.updateMany({ where: { id: runId, ownerId, status: "planning" }, data: { status: "running" } });
    return existingSteps;
  }
  // executeRun may already have moved queued → planning; tolerate that.
  if ((run.status as AgentRunStatus) === "queued") {
    await setRunStatus(runId, "queued", "planning", { startedAt: run.startedAt ?? new Date() });
  } else if ((run.status as AgentRunStatus) !== "planning") {
    assertRunTransition(run.status as AgentRunStatus, "planning");
  }
  const metadata = z.object({
    contextFileIds: z.array(z.string()).default([]),
    routine: z.object({ canProposeTask: z.boolean() }).optional(),
  }).parse(JSON.parse(run.metadata));
  const steps = await planWorkspaceRun({
    userId: ownerId,
    agentId: run.agentId,
    currentGoal: run.goal,
    conversationId: run.conversationId ?? undefined,
    projectId: run.projectId ?? undefined,
    fileIds: metadata.contextFileIds,
    canProposeTask: metadata.routine?.canProposeTask ?? true,
  });
  return db.$transaction(async (tx) => {
    const claimed = await tx.agentRun.updateMany({
      where: { id: runId, ownerId, status: "planning" },
      data: { status: "running" },
    });
    if (claimed.count) {
      await tx.agentStep.createMany({
        data: steps.map((step, sequence) => ({
          runId, sequence,
          kind: step.kind,
          title: step.title,
          description: step.description,
          status: "queued",
          input: step.toolName ? JSON.stringify({ ...step.input, toolName: step.toolName }) : null,
          requiresApproval: step.requiresApproval,
        })),
      });
    }
    return tx.agentStep.findMany({ where: { runId }, orderBy: { sequence: "asc" } });
  });
}

export async function executeRun(runId: string, ownerId: string) {
  const trace = startTrace("agent.run");
  logInfo("run.execute.start", { runId, ownerId });
  const run = await db.agentRun.findFirst({ where: { id: runId, ownerId } });
  if (!run) throw new Error("Run not found");
  const fresh = run;
  if (fresh.status === "queued" || fresh.status === "planning") {
    if (fresh.status === "queued") {
      const claimed = await db.agentRun.updateMany({
        where: { id: runId, status: "queued" },
        data: { status: "planning", startedAt: new Date() },
      });
      if (!claimed.count) return db.agentRun.findUniqueOrThrow({ where: { id: runId } });
    }
    try {
      await planRun(runId, ownerId);
    } catch (error) {
      const reason = error !== null && typeof error === "object" && "message" in error ? String(error.message) : typeof error === "string" ? error : "The AI provider returned an unknown error.";
      const failure = reason.slice(0, 240);
      if (process.env.NODE_ENV !== "production") console.error("Agent workspace planning failed:", failure);
      await db.agentRun.updateMany({
        where: { id: runId, status: "planning" },
        data: { status: "failed", errorMessage: failure },
      });
      return db.agentRun.findUniqueOrThrow({ where: { id: runId } });
    }
  }
  if (fresh.status === "awaiting_approval") {
    const pending = await db.approval.findFirst({ where: { runId, status: "pending" } });
    if (pending) return fresh;
    const linked = await db.agentStep.findFirst({ where: { runId, approvalId: { not: null } } });
    if (linked) return fresh;
    await setRunStatus(runId, "awaiting_approval", "running");
  }
  const active = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
  if (active.status !== "running" && active.status !== "awaiting_approval") return active;

  const steps = await db.agentStep.findMany({ where: { runId }, orderBy: { sequence: "asc" } });
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.status === "completed" || step.status === "skipped") continue;
    const current = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
    if (current.status === "cancelled" || current.status === "paused" || current.status === "awaiting_approval") {
      return current;
    }
    await db.agentStep.update({ where: { id: step.id }, data: { status: "running", startedAt: new Date() } });
    await db.agentRun.update({ where: { id: runId }, data: { currentStepIndex: i } });

    try {
      if (step.kind === "tool") {
        const parsed = step.input ? JSON.parse(step.input) : {};
        const toolName = String(parsed.toolName ?? "");
        const tool = getTool(toolName);
        if (!tool) throw new Error(`Unknown tool: ${toolName}`);
        const { toolName: _omit, ...toolInput } = parsed;

        if (requiresApproval(tool.risk) || step.requiresApproval) {
          tool.inputSchema.parse(toolInput);
          const approval = await db.$transaction(async (tx) => {
            const claimed = await tx.agentRun.updateMany({
              where: { id: runId, status: "running" },
              data: { status: "awaiting_approval" },
            });
            if (!claimed.count) return null;
            const created = await tx.approval.create({
              data: {
                ownerId,
                agentId: active.agentId,
                runId,
                title: step.title.slice(0, 160),
                description: step.description.slice(0, 2000),
                payload: JSON.stringify({ toolName, ...toolInput }),
                risk: tool.risk,
                expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
              },
            });
            await tx.agentStep.update({
              where: { id: step.id },
              data: { status: "awaiting_approval", approvalId: created.id },
            });
            return created;
          });
          if (approval) await audit(ownerId, "approval_create", { runId, stepId: step.id, approvalId: approval.id, toolName });
          return db.agentRun.findUniqueOrThrow({ where: { id: runId } });
        }

        const call = await db.toolCall.create({
          data: { ownerId, runId, stepId: step.id, toolName, risk: tool.risk, status: "running", input: JSON.stringify(toolInput).slice(0, 4000), startedAt: new Date() },
        });
        const parsedInput = tool.inputSchema.parse(toolInput);
        const output = await tool.execute(parsedInput as never, { ownerId, agentId: active.agentId, runId, stepId: step.id });
        await db.toolCall.update({ where: { id: call.id }, data: { status: "completed", output: JSON.stringify(output).slice(0, 4000), completedAt: new Date() } });
        await db.agentStep.update({ where: { id: step.id }, data: { status: "completed", output: JSON.stringify(output).slice(0, 4000), completedAt: new Date() } });
      } else {
        await db.agentStep.update({ where: { id: step.id }, data: { status: "completed", output: step.kind === "draft" ? step.description : `Done: ${step.title}`, completedAt: new Date() } });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Step failed";
      await db.agentStep.update({ where: { id: step.id }, data: { status: "failed", errorMessage: message.slice(0, 1000) } });
      await db.agentRun.update({ where: { id: runId }, data: { status: "failed", errorMessage: message.slice(0, 1000) } });
      await audit(ownerId, "agent_run_failed", { runId, stepId: step.id, message });
      logError("run.step.failed", { runId, stepId: step.id, error: message });
      await captureError("RUN_STEP_FAILED", { runId, stepId: step.id });
      return db.agentRun.findUniqueOrThrow({ where: { id: runId } });
    }
  }

  await db.agentRun.update({ where: { id: runId }, data: { status: "completed", completedAt: new Date() } });
  await trackUsage(ownerId, "agent_run_completed");
  await audit(ownerId, "agent_run_completed", { runId });
  logInfo("run.execute.done", trace.end({ runId }));
  return db.agentRun.findUniqueOrThrow({ where: { id: runId } });
}

export async function cancelRun(runId: string, ownerId: string) {
  const run = await db.agentRun.findFirst({ where: { id: runId, ownerId } });
  if (!run) throw new Error("Run not found");
  assertRunTransition(run.status as AgentRunStatus, "cancelled");
  const cancelled = await db.agentRun.update({ where: { id: runId }, data: { status: "cancelled", cancelledAt: new Date() } });
  await audit(ownerId, "agent_run_cancelled", { runId });
  return cancelled;
}

export async function resumeRun(runId: string, ownerId: string) {
  const run = await db.agentRun.findFirst({ where: { id: runId, ownerId }, include: { steps: true } });
  if (!run) throw new Error("Run not found");
  if (run.status === "completed") throw new Error("Run already completed.");
  if (run.status === "cancelled") throw new Error("Run was cancelled.");
  const pending = await db.approval.findFirst({ where: { runId, ownerId, status: "pending" } });
  if (pending) throw new Error("Approval still pending");
  if (run.status === "awaiting_approval" || run.status === "paused" || run.status === "running") {
    if (run.status !== "running") {
      assertRunTransition(run.status as AgentRunStatus, "running");
      await db.agentRun.update({ where: { id: runId }, data: { status: "running" } });
    }
    return executeRun(runId, ownerId);
  }
  if (run.status === "failed") {
    // Requeue without duplicating completed steps: planRun is idempotent
    // and executeRun skips completed/skipped steps.
    assertRunTransition(run.status as AgentRunStatus, "queued");
    await db.agentRun.update({ where: { id: runId }, data: { status: "queued", errorMessage: null } });
    return executeRun(runId, ownerId);
  }
  return run;
}
