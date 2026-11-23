"use client";
import Link from "next/link";
import { useState } from "react";

export function QuickCapture({ onCaptured }: { onCaptured?: () => void }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"task" | "note">("task");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, text: text.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error?.message ?? "Capture failed.");
      setText("");
      setMsg(kind === "task" ? "Task added to your planner." : "Note saved and indexing.");
      onCaptured?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Capture failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="quick-capture-mode-row">
        {(["task", "note"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            className={`quick-capture-mode${kind === k ? " is-active" : ""}`}
          >
            {k === "task" ? "Task" : "Note"}
          </button>
        ))}
        <span className="quick-capture-shortcuts">
          Files <Link href="/app/files">Upload</Link><span aria-hidden="true">·</span> Goals <Link href="/app/projects/new">New project</Link>
        </span>
      </div>
      <div className="quick-capture-form">
        <label htmlFor="quick-capture" className="sr-only">Quick capture</label>
        <input
          id="quick-capture"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          placeholder={kind === "task" ? "Capture a task…" : "Jot a note…"}
          disabled={busy}
          className="quick-capture-input"
        />
        <button type="button" onClick={() => void submit()} disabled={busy || !text.trim()} className="button primary quick-capture-submit">
          {busy ? "Saving…" : "Capture"}
        </button>
      </div>
      {msg && (
        <p role="status" style={{ fontSize: 12, color: "var(--color-muted)", margin: "6px 0 0" }}>
          {msg}
        </p>
      )}
    </div>
  );
}
