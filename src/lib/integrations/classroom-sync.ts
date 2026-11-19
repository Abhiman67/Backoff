import { db } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { listClassroomCourses } from "@/lib/integrations/classroom";
import { getClassroomAccessToken } from "@/lib/integrations/classroom-token";

export async function syncClassroomTasks(ownerId: string) {
  const accessToken = await getClassroomAccessToken(ownerId);
  if (!accessToken) return { synced: 0, notified: 0 };
  const courses = await listClassroomCourses(accessToken);
  let synced = 0;
  let notified = 0;
  for (const course of courses) {
    for (const item of course.assignments) {
      const title = `${item.title} · ${course.name}`;
      const externalId = `${course.id}:${item.id}`;
      const dueDate = item.dueDate ? new Date(item.dueDate) : null;
      const existing = await db.task.findUnique({ where: { ownerId_externalProvider_externalId: { ownerId, externalProvider: "classroom", externalId } }, select: { completedAt: true } });
      await db.task.upsert({
        where: { ownerId_externalProvider_externalId: { ownerId, externalProvider: "classroom", externalId } },
        create: {
          ownerId, title, dueDate,
          priority: item.status === "overdue" ? "high" : "medium",
          status: item.status === "completed" ? "completed" : "todo",
          completedAt: item.status === "completed" ? new Date() : null,
          externalProvider: "classroom", externalId, externalUrl: item.link, externalStatus: item.status,
        },
        update: {
          title, dueDate, externalUrl: item.link, externalStatus: item.status,
          ...(item.status === "completed" ? { status: "completed", completedAt: existing?.completedAt ?? new Date() } : {}),
        },
      });
      synced += 1;
      if (item.status === "due_soon" || item.status === "overdue" || item.status === "pending") {
        const kind = item.status === "overdue" ? "classroom_overdue" : item.status === "due_soon" ? "classroom_due_soon" : "classroom_pending";
        const result = await notify(ownerId, { kind, title: `${item.status === "overdue" ? "Overdue" : item.status === "due_soon" ? "Due soon" : "Pending"}: ${item.title}`, body: `From ${course.name}. Open it to make a focused plan.`, link: "/app/tasks", groupedKey: `classroom:${externalId}:${item.status}` });
        if (result) notified += 1;
      }
    }
  }
  return { synced, notified };
}
