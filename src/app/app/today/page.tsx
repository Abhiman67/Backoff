import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { TodayPlan } from "@/components/TodayPlan";
import { getCurrentUser } from "@/lib/current-user";

export default async function TodayPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const [tasks, sessions, calendarAccount] = await Promise.all([
    db.task.findMany({
      where: { ownerId: user.id, status: { notIn: ["completed", "cancelled"] }, dueDate: { lt: end } },
      orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
      include: { subject: { select: { name: true } }, project: { select: { name: true } } },
    }),
    db.revisionSession.findMany({
      where: { ownerId: user.id, status: "planned", scheduledFor: { lt: end } },
      orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
      include: { subject: { select: { name: true } } },
    }),
    db.integrationAccount.findUnique({ where: { ownerId_provider: { ownerId: user.id, provider: "calendar" } }, select: { accessTokenEncrypted: true } }),
  ]);

  return <TodayPlan calendarConnected={Boolean(calendarAccount?.accessTokenEncrypted)} tasks={tasks.map((task) => ({
    id: task.id,
    title: task.title,
    dueDate: task.dueDate?.toISOString() ?? null,
    priority: task.priority,
    externalUrl: task.externalUrl,
    subjectName: task.subject?.name ?? null,
    projectName: task.project?.name ?? null,
  }))} sessions={sessions.map((item) => ({
    id: item.id,
    subjectId: item.subjectId,
    title: item.title,
    scheduledFor: item.scheduledFor?.toISOString() ?? null,
    durationMin: item.durationMin,
    subjectName: item.subject.name,
  }))} />;
}
