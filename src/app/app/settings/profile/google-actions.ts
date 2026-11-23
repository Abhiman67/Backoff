"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { GOOGLE_LINK_COOKIE, googleSignInEnabled } from "@/lib/auth-options";

export async function linkGoogleAccount() {
  const userId = (await auth())?.user?.id;
  if (!userId) redirect("/login");
  if (!googleSignInEnabled()) redirect("/app/settings/profile");

  const cookieStore = await cookies();
  cookieStore.set(GOOGLE_LINK_COOKIE, userId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  await signIn("google", { redirectTo: "/app/settings/profile?google=linked" });
}
