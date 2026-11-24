"use client";

import { useRef, type ReactNode } from "react";

export default function MobilePublicMenu({ children }: { children: ReactNode }) {
  const menu = useRef<HTMLDetailsElement>(null);
  function close() {
    if (!menu.current) return;
    menu.current.open = false;
    menu.current.querySelector("summary")?.focus();
  }
  return (
    <details ref={menu} className="mobile-menu" onKeyDown={(event) => {
      if (event.key === "Escape" && menu.current?.open) close();
    }}>
      <summary aria-label="Navigation menu">☰</summary>
      <div className="mobile-panel" onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("a")) close();
      }}>{children}</div>
    </details>
  );
}
