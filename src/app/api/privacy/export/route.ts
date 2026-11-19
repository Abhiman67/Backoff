import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleApi, notFound } from "@/lib/api";

export const GET = handleApi(async (_request, { userId }) => {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, createdAt: true, updatedAt: true, profile: true },
  });
  if (!user) throw notFound("User");

  const [agents, projects, tasks, files, fileChunks, subjects, applications, approvals, conversations,
    agentRuns, toolCalls, recommendations, responsibilities, notifications, noteLinks, noteRevisions,
    auditEvents, integrations, usageEvents, subscription, jobRecords, memberships] = await Promise.all([
    db.agent.findMany({ where: { ownerId: userId } }),
    db.project.findMany({ where: { ownerId: userId }, include: { milestones: true, risks: true } }),
    db.task.findMany({ where: { ownerId: userId } }),
    db.file.findMany({ where: { ownerId: userId }, select: { id: true, ownerId: true, name: true, mimeType: true, size: true, status: true, textContent: true, failureReason: true, subjectId: true, projectId: true, careerGoalId: true, folder: true, tags: true, createdAt: true } }),
    db.fileChunk.findMany({ where: { ownerId: userId } }),
    db.subject.findMany({ where: { ownerId: userId }, include: { topics: { include: { evidence: true } }, outcomes: true, sessions: true } }),
    db.application.findMany({ where: { ownerId: userId } }),
    db.approval.findMany({ where: { ownerId: userId } }),
    db.conversation.findMany({ where: { userId }, include: { messages: true } }),
    db.agentRun.findMany({ where: { ownerId: userId }, include: { steps: true } }),
    db.toolCall.findMany({ where: { ownerId: userId } }),
    db.recommendation.findMany({ where: { ownerId: userId } }),
    db.agentResponsibility.findMany({ where: { ownerId: userId } }),
    db.notification.findMany({ where: { ownerId: userId } }),
    db.noteLink.findMany({ where: { ownerId: userId } }),
    db.noteRevision.findMany({ where: { ownerId: userId } }),
    db.auditEvent.findMany({ where: { ownerId: userId } }),
    db.integrationAccount.findMany({ where: { ownerId: userId }, select: { provider: true, scopes: true, expiresAt: true, createdAt: true, updatedAt: true } }),
    db.usageEvent.findMany({ where: { ownerId: userId } }),
    db.subscription.findUnique({ where: { userId }, select: { plan: true, status: true, currentPeriodEnd: true, createdAt: true, updatedAt: true } }),
    db.jobRecord.findMany({ where: { userId }, select: { type: true, payload: true, status: true, retries: true, createdAt: true, updatedAt: true } }),
    db.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true, role: true, createdAt: true } }),
  ]);

  return NextResponse.json({
    format: "backoff-workspace-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    user,
    agents,
    projects,
    tasks,
    files,
    fileChunks,
    courses: subjects,
    applications,
    approvals,
    conversations,
    agentRuns,
    toolCalls,
    recommendations,
    responsibilities,
    notifications,
    noteLinks,
    noteRevisions,
    auditEvents,
    integrations,
    usageEvents,
    subscription,
    jobRecords,
    memberships,
  }, { headers: { "Cache-Control": "no-store", "Content-Disposition": "attachment; filename=vidyasarthi-workspace-export.json" } });
}, { rateLimit: { keyPrefix: "privacy-export", limit: 3, windowSec: 3600 } });
