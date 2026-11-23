"use client";
import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthShell } from "./AuthShell";
import { GoogleSignInButton } from "./GoogleSignInButton";

export default function SignupForm({ googleEnabled, passwordEnabled }: { googleEnabled: boolean; passwordEnabled: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const invitedEmail = new URLSearchParams(window.location.search).get("email");
    if (!invitedEmail) return;
    const timer = window.setTimeout(() => setEmail(invitedEmail), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Signup failed.");
        return;
      }
      const login = await signIn("credentials", { email, password, redirect: false });
      if (!login || login.error) setError("Account created. Please sign in.");
      else router.push("/app");
    } catch {
      setError("Couldn’t connect. Please try again.");
    }
  }

  return (
    <AuthShell title="Make space for what’s next." description="Create your workspace and bring your studies together.">
      {googleEnabled && <GoogleSignInButton redirectTo="/app/settings/integrations" />}
      {googleEnabled && passwordEnabled && <div className="auth-divider"><span>or continue with email</span></div>}
      {passwordEnabled && (
        <form className="auth-form" onSubmit={onSubmit}>
          <label htmlFor="su-name">Full name</label>
          <input id="su-name" autoComplete="name" required placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          <label htmlFor="su-email">Email address</label>
          <input id="su-email" type="email" autoComplete="email" required placeholder="you@university.edu" value={email} onChange={(e) => setEmail(e.target.value)} />
          <label htmlFor="su-pass">Password</label>
          <input id="su-pass" type="password" autoComplete="new-password" required minLength={8} placeholder="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" type="submit">Create account <span aria-hidden="true">↗</span></button>
        </form>
      )}
      <p className="auth-switch">Already have an account? <Link href="/login">Sign in</Link></p>
    </AuthShell>
  );
}
