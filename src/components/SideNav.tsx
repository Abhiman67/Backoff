"use client";
import { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavLink = { label: string; href: string; icon: string };

const workspace: NavLink[] = [
  { label: "Overview", href: "/app", icon: "⌂" },
  { label: "Today", href: "/app/today", icon: "◷" },
  { label: "My agents", href: "/app/agents", icon: "✦" },
  { label: "Tasks", href: "/app/tasks", icon: "✓" },
  { label: "Projects", href: "/app/projects", icon: "▣" },
];

const sections = [
  { title: "Workspace", links: workspace },
  { title: "Study", links: [
    { label: "Learning", href: "/app/learning", icon: "◒" },
    { label: "Knowledge", href: "/app/knowledge", icon: "↥" },
    { label: "Career", href: "/app/career", icon: "↗" },
  ] },
  { title: "Manage", links: [
    { label: "Routines", href: "/app/responsibilities", icon: "◔" },
    { label: "Settings", href: "/app/settings", icon: "◈" },
    { label: "Usage & plan", href: "/app/usage", icon: "◧" },
  ] },
];

const mobileLinks = workspace.slice(0, 4);
const mobileSections = [
  { title: "Workspace", links: workspace.slice(mobileLinks.length) },
  ...sections.slice(1),
];

function navState(path: string, href: string) {
  const page = path === href;
  const active = page || (href !== "/app" && path.startsWith(href + "/"))
    || (href === "/app/learning" && path === "/app/progress");
  return {
    className: active ? "active" : undefined,
    "aria-current": page ? "page" : active ? "location" : undefined,
  } satisfies React.AriaAttributes & { className?: string };
}

function NavSections({ groups, path, onNavigate }: {
  groups: typeof sections;
  path: string;
  onNavigate?: () => void;
}) {
  return groups.map(({ title, links }) => (
    <div key={title} className="dash-nav-group" role="group" aria-label={title}>
      <div className="label" aria-hidden="true">{title}</div>
      {links.map(({ label, href, icon }) => (
        <Link key={href} href={href} {...navState(path, href)} onClick={onNavigate}>
          <span className="ic" aria-hidden="true">{icon}</span>{label}
        </Link>
      ))}
    </div>
  ));
}

export function SideNav() {
  const path = usePathname();
  return (
    <nav className="dash-nav" aria-label="Workspace">
      <NavSections groups={sections} path={path} />
    </nav>
  );
}

export function MobileNav() {
  const path = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  function closeMore() {
    if (menu.current) menu.current.open = false;
  }
  const moreActive = mobileSections.some(({ links }) => links.some(({ href }) => navState(path, href).className));

  return (
    <nav className="mobile-nav" aria-label="Mobile workspace">
      {mobileLinks.map(({ label, href, icon }) => (
        <Link key={href} href={href} {...navState(path, href)} onClick={closeMore}>
          <span aria-hidden="true">{icon}</span>{label}
        </Link>
      ))}
      <details ref={menu} className="mobile-nav-more" onKeyDown={(event) => {
        if (event.key !== "Escape" || !event.currentTarget.open) return;
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }}>
        <summary className={moreActive ? "active" : undefined}><span aria-hidden="true">⋯</span>More</summary>
        <div className="dash-nav mobile-nav-panel">
          <NavSections groups={mobileSections} path={path} onNavigate={closeMore} />
        </div>
      </details>
    </nav>
  );
}
