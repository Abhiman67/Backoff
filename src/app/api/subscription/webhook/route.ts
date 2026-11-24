import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";

function validSignature(payload: string, signature: string, secret: string) {
  const timestamp = signature.split(",").find((p) => p.startsWith("t="))?.slice(2);
  const value = signature.split(",").find((p) => p.startsWith("v1="))?.slice(3);
  if (!timestamp || !value || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return value.length === expected.length && timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

export async function POST(req: Request) {
  const payload = await req.text();
  const signature = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret || !validSignature(payload, signature, secret)) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  let event: { id?: string; type: string; data?: { object?: Record<string, unknown> } };
  try { event = JSON.parse(payload) as typeof event; } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!event.id) return NextResponse.json({ error: "Missing event ID" }, { status: 400 });
  const eventId = event.id;
  try {
    await db.$transaction(async (tx) => {
      await tx.billingEvent.create({ data: { provider: "stripe", providerEventId: eventId, eventType: event.type } });
      const object = event.data?.object ?? {};
      const metadata = (object.metadata ?? {}) as Record<string, string>;
      let userId = metadata.userId || (object.client_reference_id as string | undefined);
      if (!userId) {
        const email = ((object.customer_details as Record<string, unknown> | undefined)?.email as string | undefined) || (object.customer_email as string | undefined);
        if (email) userId = (await tx.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true } }))?.id;
      }
      const customerId = object.customer as string | undefined;
      if (!userId && customerId) userId = (await tx.subscription.findFirst({ where: { providerCustomerId: customerId }, select: { userId: true } }))?.userId;
      const subId = (event.type === "checkout.session.completed" ? object.subscription : object.id) as string | undefined;
      const subscriptionStatus = object.status as string | undefined;
      const active = event.type === "checkout.session.completed" || ((event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") && (subscriptionStatus === "active" || subscriptionStatus === "trialing"));
      const inactive = event.type === "customer.subscription.deleted";
      const recognized = active || inactive || event.type === "customer.subscription.created" || event.type === "customer.subscription.updated";
      if (userId && recognized) await tx.subscription.upsert({ where: { userId }, create: { userId, plan: active ? "pro" : "free", status: active ? "active" : "cancelled", provider: "stripe", providerCustomerId: customerId, providerSubId: subId }, update: { plan: active ? "pro" : "free", status: active ? "active" : "cancelled", provider: "stripe", providerCustomerId: customerId, providerSubId: subId } });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" &&
        await db.billingEvent.findFirst({ where: { provider: "stripe", providerEventId: eventId } })) {
      return NextResponse.json({ received: true, duplicate: true });
    }
    throw error;
  }
  return NextResponse.json({ received: true });
}
