"use client";
import { useEffect, useState } from "react";

export default function UsagePage() {
  const [usage, setUsage] = useState<any>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, setPending] = useState<"checkout" | "portal" | null>(null);
  async function load() {
    setError("");
    try { const res = await fetch("/api/usage", { cache: "no-store" }); const data = await res.json(); if (!res.ok) throw new Error(data.error ?? "Unable to load usage"); setUsage(data); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load usage"); }
  }
  useEffect(() => {
    let active = true;
    fetch("/api/usage", { cache: "no-store" }).then(async (res) => { const data = await res.json(); if (!active) return; if (!res.ok) setError(data.error ?? "Unable to load usage"); else setUsage(data); }).catch((e) => { if (active) setError(e instanceof Error ? e.message : "Unable to load usage"); });
    return () => { active = false; };
  }, []);
  async function openBilling(action: "checkout" | "portal") {
    if (pending) return;
    setPending(action);
    setMsg("");
    try {
      const response = await fetch(`/api/subscription/${action}`, { method: "POST" });
      const data = await response.json();
      if (response.ok && typeof data?.url === "string" && data.url) {
        window.location.assign(data.url);
        return;
      }
      setMsg(typeof data?.error === "string" ? data.error : "Billing is unavailable. Please try again.");
    } catch {
      setMsg("Couldn’t open billing. Please try again.");
    }
    setPending(null);
  }
  if (error) return <main className="mx-auto max-w-md p-8 text-center"><h1>Usage unavailable</h1><p className="mt-2 text-sm text-muted">{error}</p><button className="button primary sm mt-4" onClick={load}>Retry</button></main>;
  if (!usage) return <main className="p-8">Loading usage…</main>;
  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <div className="page-head">
        <div>
          <h1>Usage and plan</h1>
          <p>Transparent limits, no surprises.</p>
        </div>
      </div>
      <div className="card">
        <p className="font-bold">{usage.plan}</p>
        <p className="mt-3 text-sm">Agents: {usage.agents} ({usage.limits?.agents})</p>
        <p className="text-sm">Messages: {usage.limits.messages.used} / {usage.limits?.messages?.limit ?? "—"}</p>
        <p className="text-sm">Files: {usage.files} / {usage.limits?.files?.limit ?? "—"}</p>
        <p className="text-sm">Approvals accepted: {usage.byType?.approval_accepted ?? 0} · denied: {usage.byType?.approval_denied ?? 0}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
          <button disabled={pending !== null} onClick={() => openBilling("checkout")} className="button primary sm">{pending === "checkout" ? "Opening checkout…" : "Upgrade / checkout"}</button>
          <button disabled={pending !== null} onClick={() => openBilling("portal")} className="button secondary sm">{pending === "portal" ? "Opening billing…" : "Manage billing"}</button>
        </div>
        {msg && <p role="alert" className="mt-2 text-sm text-muted">{msg}</p>}
      </div>
    </main>
  );
}
