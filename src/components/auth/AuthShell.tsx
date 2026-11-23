import Link from "next/link";
import type { ReactNode } from "react";

export function AuthShell({ title, description, children }: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main id="main" className="auth-page">
      <div className="auth-layout">
        <section className="auth-intro">
          <span className="auth-kicker">YOUR SPACE TO MOVE FORWARD</span>
          <h1>A little more clarity for your student life<span>.</span></h1>
          <p>Bring your courses, notes, and next steps together with your own AI study team.</p>
          <div className="auth-intro-bottom">
            <span className="auth-intro-dot" />
            Built for the work you’re already doing.
          </div>
        </section>
        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-card-heading">
            <h2 id="auth-title">{title}</h2>
            <p>{description}</p>
          </div>
          {children}
          <p className="auth-legal">By continuing, you agree to our <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.</p>
        </section>
      </div>
    </main>
  );
}
