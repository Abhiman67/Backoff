import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { applicationCreateSchema, applicationUpdateSchema } from "@/lib/validations";
import { handleApi, invalid, notFound } from "@/lib/api";

export const GET = handleApi(async (req, { userId: id }) => {
  const url = new URL(req.url);
  const take = Math.min(Math.max(Number(url.searchParams.get("take") || 50), 1), 100);
  const cursor = url.searchParams.get("cursor");
  const apps = await db.application.findMany({ where: { ownerId: id }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: take + 1, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
  const hasMore = apps.length > take;
  if (hasMore) apps.pop();
  const followUps = await db.task.findMany({ where: { ownerId: id, externalProvider: "career", externalId: { in: apps.map((app) => app.id) } }, select: { externalId: true, dueDate: true } });
  const followUpByApplication = new Map(followUps.map((task) => [task.externalId, task.dueDate?.toISOString().slice(0, 10) ?? null]));
  return NextResponse.json({ applications: apps.map((app) => ({ ...app, followUpDate: followUpByApplication.get(app.id) ?? null })), nextCursor: hasMore ? apps.at(-1)?.id ?? null : null });
});

export const POST = handleApi(async (req, { userId: id }) => {
  const parsed = applicationCreateSchema.safeParse(await req.json());
  if (!parsed.success) throw invalid("Company and role required");
  const { company, role, url, status, notes } = parsed.data;
  const app = await db.application.create({
    data: { ownerId: id, company, role, url: url ?? "", status: status ?? "saved", notes: notes ?? "" },
  });
  return NextResponse.json({ application: app }, { status: 201 });
});

export const PATCH = handleApi(async (req, { userId: id }) => {
  const parsed = applicationUpdateSchema.safeParse(await req.json());
  if (!parsed.success) throw invalid("Invalid application update");
  const { id: appId, status, notes, followUpDate } = parsed.data;
  const existing = await db.application.findFirst({ where: { id: appId, ownerId: id } });
  if (!existing) throw notFound("Application");
  const app = await db.application.update({ where: { id: appId }, data: { ...(status ? { status } : {}), ...(notes !== undefined ? { notes } : {}) } });
  let savedFollowUpDate: string | null | undefined;
  if (followUpDate !== undefined) {
    if (!followUpDate) {
      await db.task.deleteMany({ where: { ownerId: id, externalProvider: "career", externalId: appId } });
      savedFollowUpDate = null;
    } else {
      const dueDate = new Date(followUpDate);
      const followUp = await db.task.upsert({
        where: { ownerId_externalProvider_externalId: { ownerId: id, externalProvider: "career", externalId: appId } },
        create: { ownerId: id, title: `Follow up: ${existing.role} at ${existing.company}`, dueDate, priority: "medium", status: "todo", externalProvider: "career", externalId: appId, externalUrl: existing.url },
        update: { title: `Follow up: ${existing.role} at ${existing.company}`, dueDate, status: "todo", externalUrl: existing.url },
        select: { dueDate: true },
      });
      savedFollowUpDate = followUp.dueDate?.toISOString().slice(0, 10) ?? null;
    }
  } else {
    const followUp = await db.task.findUnique({ where: { ownerId_externalProvider_externalId: { ownerId: id, externalProvider: "career", externalId: appId } }, select: { dueDate: true } });
    savedFollowUpDate = followUp?.dueDate?.toISOString().slice(0, 10) ?? null;
  }
  return NextResponse.json({ application: { ...app, followUpDate: savedFollowUpDate } });
});

export const DELETE = handleApi(async (req, { userId: id }) => {
  const { searchParams } = new URL(req.url);
  const appId = searchParams.get("id");
  if (!appId) throw invalid("id required");
  const existing = await db.application.findFirst({ where: { id: appId, ownerId: id } });
  if (!existing) throw notFound("Application");
  await db.$transaction([
    db.task.deleteMany({ where: { ownerId: id, externalProvider: "career", externalId: appId } }),
    db.application.delete({ where: { id: appId } }),
  ]);
  return NextResponse.json({ ok: true });
});
