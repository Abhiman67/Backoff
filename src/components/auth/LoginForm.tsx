"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthShell } from "./AuthShell";
import { GoogleSignInButton } from "./GoogleSignInButton";

export default function LoginForm({ googleEnabled, initialError }: { googleEnabled: boolean; initialError: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const res = await signIn("credentials", { email, password, redirect: false });
      if (!res || res.error) setError("Couldn’t sign in. Check your email and password and try again.");
      else router.push("/app");
    } catch {
      setError("Couldn’t connect. Please try again.");
    }
  }

  return (
    <AuthShell title="Welcome back." description="Sign in to pick up where you left off.">
      {googleEnabled && (
        <>
          <GoogleSignInButton redirectTo="/app" />
          <div className="auth-divider"><span>or continue with email</span></div>
        </>
      )}
      <form className="auth-form" onSubmit={onSubmit}>
        <label htmlFor="login-email">Email address</label>
        <input id="login-email" type="email" autoComplete="email" required placeholder="you@university.edu" value={email} onChange={(e) => setEmail(e.target.value)} />
        <div className="auth-label-row"><label htmlFor="login-pass">Password</label><Link href="/forgot-password">Forgot password?</Link></div>
        <input id="login-pass" type="password" autoComplete="current-password" required placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="auth-submit" type="submit">Sign in <span aria-hidden="true">↗</span></button>
      </form>
      <p className="auth-switch">New to VidyaSarthi? <Link href="/signup">Create an account</Link></p>
    </AuthShell>
  );
}
