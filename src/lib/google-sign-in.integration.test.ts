import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resolveGoogleUser } from "@/lib/google-sign-in";

describe("Google sign-in", () => {
  it("creates one account and workspace and signs in by Google identity on return", async () => {
    const identity = { subject: "google-new", email: "new-google@example.test", name: "New Student", link: null };
    const first = await resolveGoogleUser(identity);
    expect(first.kind).toBe("signed-in");
    if (first.kind !== "signed-in") throw new Error("Google account was not created");
    expect(await db.workspaceMember.count({ where: { userId: first.user.id, role: "owner" } })).toBe(1);
    expect(await resolveGoogleUser({ ...identity, email: "updated-google@example.test" })).toEqual(first);
  });

  it("requires a matching signed-in account before linking an existing workspace", async () => {
    const user = await db.user.create({
      data: { name: "Existing Student", email: "existing-google@example.test", passwordHash: "legacy-test-hash" },
    });
    const identity = { subject: "google-existing", email: user.email };
    expect(await resolveGoogleUser({ ...identity, link: null })).toEqual({ kind: "link-required" });
    expect(await resolveGoogleUser({ ...identity, link: { requestedId: user.id, sessionId: undefined } }))
      .toEqual({ kind: "link-email" });

    const linked = await resolveGoogleUser({ ...identity, link: { requestedId: user.id, sessionId: user.id } });
    expect(linked).toMatchObject({ kind: "signed-in", user: { id: user.id } });
    expect(await resolveGoogleUser({ ...identity, link: null })).toEqual(linked);
    expect(await db.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } }))
      .toEqual({ passwordHash: "legacy-test-hash" });
  });

  it("connects a verified Google Workspace identity to its existing workspace", async () => {
    const user = await db.user.create({
      data: { name: "College student", email: "student@college.example", passwordHash: "legacy" },
    });
    const identity = { subject: "college-subject", email: user.email, hostedDomain: "college.example", link: null };
    expect(await resolveGoogleUser(identity)).toMatchObject({ kind: "signed-in", user: { id: user.id } });
    expect(await resolveGoogleUser(identity)).toMatchObject({ kind: "signed-in", user: { id: user.id } });
    expect(await resolveGoogleUser({ ...identity, subject: "other-subject" })).toEqual({ kind: "link-conflict" });
  });
});
