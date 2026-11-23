import AppShell from "@/components/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/login");
  const account = await db.user.findUnique({
    where: { email },
    select: { name: true, email: true },
  });
  if (!account) redirect("/login");
  return (
    <AppShell account={account}>
      <ErrorBoundary>{children}</ErrorBoundary>
    </AppShell>
  );
}

