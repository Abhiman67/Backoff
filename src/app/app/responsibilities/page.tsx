"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorState } from "@/components/states";
import { ConfirmDialog } from "@/components/Dialog";
import Dropdown from "@/components/Dropdown";

type Routine = {
  id: string; title: string; instruction: string; triggerType: string;
  triggerValue: string; actionPolicy: string; status: string;
  lastRunAt: string | null; nextRunAt: string | null;
  agent: { name: string; template: string };
};

type AgentOpt = { id: string; name: string };

export default function ResponsibilitiesPage() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [agents, setAgents] = useState<AgentOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [findings, setFindings] = useState<Record<string, string>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [actionPolicy, setActionPolicy] = useState("suggest_only");
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const [agentId, setAgentId] = useState("");
  const [schedule, setSchedule] = useState("daily");
  const [routineToDelete, setRoutineToDelete] = useState<Routine | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [rRes, aRes] = await Promise.all([
        fetch("/api/responsibilities", { cache: "no-store" }),
        fetch("/api/agents?view=roster", { cache: "no-store" }),
      ]);
      if (!rRes.ok) throw new Error("Could not load routines.");
      setRoutines((await rRes.json()).responsibilities ?? []);
      if (aRes.ok) setAgents(((await aRes.json()).agents ?? []).map((a: AgentOpt) => ({ id: a.id, name: a.name })));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function call(path: string, method = "POST", body?: unknown) {
    const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error?.message ?? "Action failed.");
    }
    return res.json();
  }

  async function create() {
    if (!title.trim() || !agentId) {
      setError("Pick an agent and a title.");
      return;
    }
    try {
      await call("/api/responsibilities", "POST", { agentId, title: title.trim(), instruction: instruction.trim() || undefined, triggerValue: schedule, actionPolicy });
      setTitle("");
      setInstruction("");
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed.");
    }
  }

  async function act(id: string, action: "pause" | "resume" | "trigger") {
    try {
      if (action === "trigger") setRunning(id);
      const result = await call(`/api/responsibilities/${id}/${action}`);
      if (action === "trigger") {
        const finding = result.run?.status === "failed"
          ? result.run.errorMessage || "The routine failed."
          : result.finding || "Check Approvals for any proposed action.";
        setFindings(current => ({ ...current, [id]: finding }));
      }
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      if (action === "trigger") setRunning(null);
    }
  }

  async function handleConfirmDelete() {
    if (!routineToDelete) return;
    setDeleting(true);
    try {
      await call(`/api/responsibilities/${routineToDelete.id}`, "DELETE");
      setRoutineToDelete(null);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setDeleting(false);
    }
  }

  async function pauseAll() {
    try {
      await call("/api/responsibilities/pause-all");
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pause-all failed.");
    }
  }

  if (loading) return <main className="p-8">Loading routines…</main>;

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", paddingBottom: 40 }}>
      <div className="page-head">
        <div>
          <h1>Routines</h1>
          <p>Background checks your agents run on a schedule. Suggest-only by default — writes always pause for approval.</p>
        </div>
        <button type="button" onClick={() => void pauseAll()} className="button secondary sm">Pause all</button>
      </div>
      {error && <ErrorState message={error} retry={() => void load()} />}
      <div className="panel" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, margin: "0 0 8px" }}>New routine</h2>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Dropdown
              value={agentId}
              options={[{ value: "", label: "Pick an agent…" }, ...agents.map((a) => ({ value: a.id, label: a.name }))]}
              onChange={setAgentId}
              label="Agent"
            />
            <Dropdown
              value={schedule}
              options={[
                { value: "daily", label: "Daily" },
                { value: "weekly", label: "Weekly" },
                { value: "every_12h", label: "Every 12h" },
                { value: "every_6h", label: "Every 6h" },
                { value: "every_1h", label: "Hourly" },
              ]}
              onChange={setSchedule}
              label="Schedule"
            />
          </div>
          <Dropdown
            value={actionPolicy}
            options={[
              { value: "suggest_only", label: "Report findings" },
              { value: "approval_required", label: "Propose a task for approval" },
            ]}
            onChange={setActionPolicy}
            label="Routine result"
          />
          <label className="sr-only" htmlFor="routine-title">Title</label>
          <input id="routine-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Morning revision check" className="qa-control" />
          <label className="sr-only" htmlFor="routine-instruction">Instruction</label>
          <input id="routine-instruction" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Instruction (optional — defaults to title)" className="qa-control" />
          <div>
            <button type="button" onClick={() => void create()} disabled={!title.trim() || !agentId} className="button primary sm">Create routine</button>
          </div>
        </div>
      </div>
      {routines.length === 0 ? (
        <EmptyState title="No routines yet" body="Try a daily Study Coach check for upcoming assignments." />
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {routines.map((r) => (
            <div key={r.id} className="panel">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <div>
                  <b style={{ fontSize: 14 }}>{r.title}</b>
                  <p style={{ fontSize: 12, color: "var(--color-muted)", margin: "2px 0 0" }}>
                    {r.agent.name} · {r.triggerValue} · {r.actionPolicy.replace(/_/g, " ")}
                    {r.nextRunAt && r.status === "active" ? ` · next ${new Date(r.nextRunAt).toLocaleString()}` : ""}
                    {r.lastRunAt ? ` · last run ${new Date(r.lastRunAt).toLocaleString()}` : ""}
                  </p>
                </div>
                <span className="tag">{r.status}</span>
              </div>
              {findings[r.id] && <p role="status">{findings[r.id]}</p>}
              <div className="routine-actions">
                <button type="button" className="file-action file-action-primary" disabled={r.status !== "active" || running !== null} onClick={() => void act(r.id, "trigger")}>{running === r.id ? "Checking…" : "Run now"}</button>
                {r.status === "active" ? (
                  <button type="button" className="file-action" onClick={() => void act(r.id, "pause")}>Pause</button>
                ) : r.status === "paused" ? (
                  <button type="button" className="file-action" onClick={() => void act(r.id, "resume")}>Resume</button>
                ) : null}
                <Link href="/app/approvals" className="file-action">Approvals →</Link>
                <button type="button" className="file-action file-action-danger" onClick={() => setRoutineToDelete(r)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        isOpen={Boolean(routineToDelete)}
        onClose={() => setRoutineToDelete(null)}
        onConfirm={() => void handleConfirmDelete()}
        title={`Delete "${routineToDelete?.title}"?`}
        description="This routine will stop running. Past approvals it created are kept in the audit log."
        confirmText="Delete routine"
        cancelText="Cancel"
        variant="danger"
        loading={deleting}
      />
    </main>
  );
}
