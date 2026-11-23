"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

export function GoogleSignInButton({ redirectTo }: { redirectTo: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function continueWithGoogle() {
    setBusy(true);
    setFailed(false);
    try {
      await signIn("google", { redirectTo });
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="auth-google-wrap">
      <button
        type="button"
        className="auth-google-button"
        disabled={busy}
        onClick={continueWithGoogle}
      >
        <span className="auth-google-icon" aria-hidden="true">G</span>
        {busy ? "Opening Google…" : "Continue with Google"}
      </button>
      {failed && <p role="alert" className="mt-2">Couldn’t open Google sign-in. Try again.</p>}
    </div>
  );
}
