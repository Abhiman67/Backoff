import { cache } from "react";
import { auth } from "@/auth";
import { db } from "@/lib/db";

/** Reuse the authenticated user's database row across server components in one request. */
export const getCurrentUser = cache(async () => {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;

  return db.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      profile: {
        select: {
          onboardingDone: true,
          institution: true,
          degree: true,
          semester: true,
          studyHours: true,
          careerTarget: true,
        },
      },
    },
  });
});
