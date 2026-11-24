import AppShell from "@/components/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { getCurrentUser } from "@/lib/current-user";
import { redirect } from "next/navigation";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <AppShell account={{ name: user.name, email: user.email }}>
      <ErrorBoundary>{children}</ErrorBoundary>
    </AppShell>
  );
}

