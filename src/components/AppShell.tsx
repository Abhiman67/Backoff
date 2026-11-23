import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { cookies } from "next/headers";
import { signOut } from "@/auth";
import Topbar from "./Topbar";
import { SideNav, MobileNav } from "./SideNav";
import SidebarUpgrade from "./SidebarUpgrade";

export default async function AppShell({ children, account }: {
  children: React.ReactNode;
  account: { name: string; email: string };
}) {
  const { email } = account;
  const name = account.name.trim() || email;
  const tag = account.name.trim()
    ? name.split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join("").toUpperCase()
    : email.slice(0, 2).toUpperCase();

  const cookieStore = await cookies();
  const initialDismissed = cookieStore.get("backoff_upgrade_dismissed")?.value === "true";

  return (
    <div className="dash-layout">
      <aside className="sidebar">
        <div className="sidebar-main">
          <Link href="/app" className="brand">
            <LogoMark /> VidyaSarthi
          </Link>
          <SideNav />
        </div>

        <div className="sidebar-footer">
          <SidebarUpgrade initialDismissed={initialDismissed} />
          <div className="dash-profile-row">
            <Link
              href="/app/settings/profile"
              className="dash-profile-info"
              title="Profile & settings"
            >
              <div className="avatar">{tag}</div>
              <div className="dash-profile-text">
                <b>{name}</b>
                <small title={email}>{email}</small>
              </div>
            </Link>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button
                type="submit"
                aria-label="Sign out"
                className="dash-signout-btn"
                title="Sign out"
              >
                ⎋
              </button>
            </form>
          </div>
        </div>
      </aside>
      <div className="main">
        <Topbar account={{ name, email, tag }} />
        {children}
      </div>
      <MobileNav />
    </div>
  );
}
