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
    <div className="mb-4">
      <button
        type="button"
        className="button primary w-full justify-center"
        disabled={busy}
        onClick={continueWithGoogle}
      >
        {busy ? "Opening Google…" : "Continue with Google"}
      </button>
      {failed && <p role="alert" className="mt-2">Couldn’t open Google sign-in. Try again.</p>}
    </div>
  );
}
