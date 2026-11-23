import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs/queue";
import { getJobMode } from "@/lib/jobs/redis";
import { logError } from "@/lib/observability/logger";
import { AGENT_TEMPLATES } from "@/lib/agents";
import { studyCoachThreadId } from "@/lib/study-coach-thread";
import { updateClassroomCoachCard } from "@/lib/classroom-coach-update";
import { notify } from "@/lib/notifications";
import { listClassroomCourses } from "@/lib/integrations/classroom";
import { getClassroomAccessToken } from "@/lib/integrations/classroom-token";

export async function syncClassroomTasks(ownerId: string) {
  const accessToken = await getClassroomAccessToken(ownerId);
  if (!accessToken) return { synced: 0, notified: 0 };
  const courses = await listClassroomCourses(accessToken);
  const settings = await db.integrationAccount.findUnique({
    where: { ownerId_provider: { ownerId, provider: "classroom" } },
    select: { autoImportAttachments: true },
  });
  const coachTemplate = AGENT_TEMPLATES.find(({ template }) => template === "study-coach");
  let threadId: string | undefined;
  let synced = 0;
  let notified = 0;
  for (const course of courses) {
    const subject = await db.subject.upsert({
      where: { ownerId_classroomCourseId: { ownerId, classroomCourseId: course.id } },
      create: { ownerId, classroomCourseId: course.id, name: course.name },
      update: { name: course.name },
    });
    for (const item of course.assignments) {
      const title = `${item.title} · ${course.name}`;
      const externalId = `${course.id}:${item.id}`;
      const dueDate = item.dueDate ? new Date(item.dueDate) : null;
      const existing = await db.task.findUnique({ where: { ownerId_externalProvider_externalId: { ownerId, externalProvider: "classroom", externalId } }, select: { completedAt: true } });
      const task = await db.task.upsert({
        where: { ownerId_externalProvider_externalId: { ownerId, externalProvider: "classroom", externalId } },
        create: {
          ownerId, title, dueDate, subjectId: subject.id,
          priority: item.status === "overdue" ? "high" : "medium",
          status: item.status === "completed" ? "completed" : "todo",
          completedAt: item.status === "completed" ? new Date() : null,
          externalProvider: "classroom", externalId, externalUrl: item.link, externalStatus: item.status,
        },
        update: {
          title, dueDate, subjectId: subject.id, externalUrl: item.link, externalStatus: item.status,
          ...(item.status === "completed" ? { status: "completed", completedAt: existing?.completedAt ?? new Date() } : {}),
        },
      });
      if (settings?.autoImportAttachments && item.driveAttachments) {
        const attachments = item.driveAttachments;
        await db.$transaction([
          db.classroomAttachment.deleteMany({ where: { taskId: task.id, driveFileId: { notIn: attachments.map((file) => file.driveFileId) } } }),
          ...attachments.map((file) => db.classroomAttachment.upsert({
            where: { taskId_driveFileId: { taskId: task.id, driveFileId: file.driveFileId } },
            create: { taskId: task.id, driveFileId: file.driveFileId, title: file.title },
            update: { title: file.title },
          })),
        ]);
      }
      if (coachTemplate && ((task.status !== "completed" && task.status !== "cancelled") || (item.status === "completed" && existing))) {
        if (!threadId) {
          const { template, name, role, description, icon, category, systemPrompt } = coachTemplate;
          const coach = await db.agent.upsert({
            where: { ownerId_template: { ownerId, template } },
            create: { ownerId, template, name, role, description, icon, category, systemPrompt },
            update: {},
          });
          threadId = studyCoachThreadId(coach.id);
          await db.conversation.upsert({
            where: { id: threadId },
            create: { id: threadId, userId: ownerId, agentId: coach.id, title: "Classroom study thread" },
            update: {},
          });
        }
        await updateClassroomCoachCard(threadId, {
          assignmentId: task.id,
          title,
          dueDate: dueDate?.toISOString() ?? null,
          status: item.status,
        });
      }
      synced += 1;
      if (item.status === "due_soon" || item.status === "overdue" || item.status === "pending") {
        const kind = item.status === "overdue" ? "classroom_overdue" : item.status === "due_soon" ? "classroom_due_soon" : "classroom_pending";
        const result = await notify(ownerId, { kind, title: `${item.status === "overdue" ? "Overdue" : item.status === "due_soon" ? "Due soon" : "Pending"}: ${item.title}`, body: `From ${course.name}. Open it to make a focused plan.`, link: `/app/assignments/${task.id}`, groupedKey: `classroom:${externalId}:${item.status}` });
        if (result) notified += 1;
      }
    }
  }
  await db.integrationAccount.updateMany({ where: { ownerId, provider: "classroom" }, data: { lastSyncedAt: new Date(), lastSyncError: null } });
  if (settings?.autoImportAttachments) {
    const cycle = Math.floor(Date.now() / (15 * 60_000));
    const pending = await db.classroomAttachment.findMany({
      where: {
        task: { ownerId, externalProvider: "classroom" }, fileId: null,
        OR: [{ attemptedAt: null }, { attemptedAt: { lt: new Date(Date.now() - 15 * 60_000) } }],
      },
      orderBy: [{ attemptedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
      select: { id: true }, take: getJobMode() === "redis" ? 25 : 1,
    });
    for (const attachment of pending) {
      await enqueue("classroom.attachment", { attachmentId: attachment.id }, {
        idempotencyKey: `classroom.attachment:${attachment.id}:${cycle}`, maxRetries: 0,
      }).catch(() => logError("classroom.attachment.enqueue_failed", { attachmentId: attachment.id }));
    }
  }
  return { synced, notified };
}
