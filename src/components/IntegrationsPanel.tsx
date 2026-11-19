"use client";
import { useEffect, useState } from "react";
import { CLASSROOM_MATERIALS_SCOPE } from "@/lib/integrations/scopes";

type Acct = { provider: string; scopes: string[] };
type Prov = { provider: string; capabilities: { name: string; kind: string }[] };

export function IntegrationsPanel() {
  const [accounts, setAccounts] = useState<Acct[]>([]);
  const [providers, setProviders] = useState<Prov[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/integrations", { cache: "no-store" });
    if (!res.ok) return;
    const d = await res.json();
    setAccounts(d.accounts ?? []);
    setProviders(d.providers ?? []);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  async function connectGoogleDrive() {
    setBusy("drive");
    setError("");
    try {
      const res = await fetch("/api/integrations/drive/connect", { cache: "no-store" });
      const d = await res.json();
      if (res.ok && d.authUrl) {
        window.location.href = d.authUrl;
        return;
      }
      setError(d.error?.message ?? "Google Drive could not be connected.");
    } catch {
      setError("Could not start Google Drive sign-in. Please try again.");
    } finally {
      setBusy("");
    }
  }

  async function connectGoogleClassroom() {
    setBusy("classroom");
    setError("");
    try {
      const res = await fetch("/api/integrations/classroom/connect", { cache: "no-store" });
      const data = await res.json();
      if (res.ok && typeof data.authUrl === "string") {
        window.location.assign(data.authUrl);
        return;
      }
      setError(data.error?.message ?? "Google Classroom OAuth is not configured yet.");
    } catch {
      setError("Could not start Google Classroom sign-in. Please try again.");
    } finally {
      setBusy("");
    }
  }

  async function connectGoogleCalendar() {
    setBusy("calendar");
    setError("");
    try {
      const res = await fetch("/api/integrations/calendar/connect", { cache: "no-store" });
      const data = await res.json();
      if (res.ok && typeof data.authUrl === "string") {
        window.location.assign(data.authUrl);
        return;
      }
      setError(data.error?.message ?? "Google Calendar OAuth is not configured yet.");
    } catch {
      setError("Could not start Google Calendar sign-in. Please try again.");
    } finally {
      setBusy("");
    }
  }

  async function disconnect(provider: string) {
    setBusy(provider);
    await fetch(`/api/integrations/${provider}`, { method: "DELETE" });
    setBusy("");
    load();
  }

  const connected = new Set(accounts.map((a) => a.provider));
  return (
    <div className="card" style={{ padding: 12 }}>
      <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Connected integrations</h3>
      <p style={{ fontSize: 12, color: "var(--color-muted)", margin: "0 0 8px" }}>Drive, Classroom, and Calendar have live read-only sync. GitHub, Notion, and Gmail agent actions are preview simulations and are not connected to their services yet. Google tokens are encrypted; disconnect removes VidyaSarthi&apos;s saved access.</p>
      {error && <p role="alert" style={{ color: "#a23627", fontSize: 12, margin: "0 0 10px" }}>{error}</p>}
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
        {providers.map((p) => (
          <li key={p.provider} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
            <b style={{ minWidth: 80 }}>{p.provider}</b>
            {(["github", "notion", "gmail"].includes(p.provider)) ? (
              <>
                <span className="tag" title="External provider actions are not implemented yet">Preview only</span>
                {connected.has(p.provider) && <button type="button" className="tag" style={{ cursor: "pointer" }} disabled={busy === p.provider} onClick={() => disconnect(p.provider)}>{busy === p.provider ? "Disconnecting…" : "Remove saved token"}</button>}
              </>
            ) : connected.has(p.provider) ? (
              <button type="button" className="tag" style={{ cursor: "pointer" }} disabled={busy === p.provider} onClick={() => disconnect(p.provider)}>Disconnect</button>
            ) : p.provider === "drive" ? (
              <button type="button" className="tag" style={{ cursor: "pointer" }} disabled={busy === p.provider} onClick={() => void connectGoogleDrive()}>Connect with Google</button>
            ) : p.provider === "classroom" ? (
              <>
                <span className="tag">{accounts.find((account) => account.provider === "classroom")?.scopes.includes(CLASSROOM_MATERIALS_SCOPE) ? "Materials enabled" : "Materials access needed"}</span>
                <button type="button" className="tag" style={{ cursor: "pointer" }} disabled={busy === p.provider} onClick={() => void connectGoogleClassroom()}>{busy === p.provider ? "Connecting…" : accounts.find((account) => account.provider === "classroom") ? "Reconnect for materials" : "Connect with Google"}</button>
              </>
            ) : p.provider === "calendar" ? (
              <button type="button" className="tag" style={{ cursor: "pointer" }} disabled={busy === p.provider} onClick={() => void connectGoogleCalendar()}>Connect with Google</button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
