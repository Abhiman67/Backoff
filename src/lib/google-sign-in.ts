import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const userIdentity = { id: true, name: true, email: true } satisfies Prisma.UserSelect;
type GoogleSignInResult =
  | { kind: "signed-in"; user: Prisma.UserGetPayload<{ select: typeof userIdentity }> }
  | { kind: "link-required" }
  | { kind: "link-email" }
  | { kind: "link-conflict" };

type GoogleIdentity = {
  subject: string;
  email: string;
  name?: string;
  link: { requestedId: string; sessionId: string | undefined } | null;
};

export async function resolveGoogleUser({ subject, email: rawEmail, name: googleName, link }: GoogleIdentity): Promise<GoogleSignInResult> {
  const email = rawEmail.toLowerCase();
  if (link && link.requestedId !== link.sessionId) return { kind: "link-email" };

  const linked = await db.user.findUnique({ where: { googleSubject: subject }, select: userIdentity });
  if (linked) {
    if (link && linked.id !== link.sessionId) return { kind: "link-conflict" };
    return { kind: "signed-in", user: linked };
  }

  const existing = await db.user.findUnique({ where: { email }, select: userIdentity });
  if (link) {
    if (!existing || existing.id !== link.sessionId) return { kind: "link-email" };
    try {
      const updated = await db.user.updateMany({
        where: { id: existing.id, OR: [{ googleSubject: null }, { googleSubject: subject }] },
        data: { googleSubject: subject },
      });
      return updated.count === 1 ? { kind: "signed-in", user: existing } : { kind: "link-conflict" };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      return { kind: "link-conflict" };
    }
  }
  if (existing) return { kind: "link-required" };

  const name = googleName?.trim().slice(0, 80) || email.split("@")[0].slice(0, 80);
  try {
    const user = await db.user.create({
      data: {
        name, email, googleSubject: subject, passwordHash: "",
        profile: { create: {} },
        memberships: { create: { role: "owner", workspace: { create: { name: `${name}'s workspace` } } } },
      },
      select: userIdentity,
    });
    return { kind: "signed-in", user };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const concurrent = await db.user.findUnique({ where: { googleSubject: subject }, select: userIdentity });
    return concurrent ? { kind: "signed-in", user: concurrent } : { kind: "link-required" };
  }
}
