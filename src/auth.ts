import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { loginSchema } from "@/lib/validations";
import { rateLimit } from "@/lib/rate-limit";
import { GOOGLE_LINK_COOKIE, googleSignInEnabled } from "@/lib/auth-options";
import { resolveGoogleUser } from "@/lib/google-sign-in";

const googleIdentity = z.object({
  email: z.email().max(255),
  email_verified: z.literal(true),
  name: z.string().optional(),
  hd: z.string().optional(),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    async signIn({ account, profile, user }) {
      if (account?.provider !== "google") return true;

      const identity = googleIdentity.safeParse(profile);
      if (!identity.success) return "/login?error=GoogleEmailUnverified";

      const cookieStore = await cookies();
      const linkUserId = cookieStore.get(GOOGLE_LINK_COOKIE)?.value;
      if (linkUserId) cookieStore.delete(GOOGLE_LINK_COOKIE);

      const result = await resolveGoogleUser({
        subject: account.providerAccountId,
        email: identity.data.email,
        name: identity.data.name,
        hostedDomain: identity.data.hd,
        link: linkUserId ? { requestedId: linkUserId, sessionId: (await auth())?.user?.id } : null,
      });

      switch (result.kind) {
        case "link-required": return "/login?error=GoogleLinkRequired";
        case "link-email": return "/app/settings/profile?google=email";
        case "link-conflict": return "/app/settings/profile?google=conflict";
        case "signed-in":
          Object.assign(user, result.user);
          return true;
      }
    },
    async jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.uid && session.user) {
        (session.user as { id?: string }).id = token.uid as string;
      }
      return session;
    },
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      if (pathname.startsWith("/app") || pathname.startsWith("/onboarding")) {
        return !!auth?.user;
      }
      return true;
    },
  },
  providers: [
    ...(googleSignInEnabled() ? [Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: { params: { prompt: "select_account" } },
    })] : []),
    Credentials({
      async authorize(credentials, req) {
        const headers = req?.headers as unknown as Record<string, string | null> | undefined;
        const ip = headers?.["x-forwarded-for"] ?? "local";
        if (!rateLimit(`login:${ip}`, 10)) throw new Error("Too many attempts");
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const user = await db.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
        });
        if (!user?.passwordHash) return null;
        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
});
