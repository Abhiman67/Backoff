"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import type { PracticeQuestion } from "@/lib/assignments";

type Source = { id: string; name: string; subjectId: string | null; sourceProvider: string | null };
type Topic = { id: string; name: string; mastery: string };
type Session = { id: string; title: string; scheduledFor: string | null };
type Material = { id: string; courseId: string; title: string; kind: string; url: string | null; driveFileId: string | null };
type ClassroomAttachment = { id: string; driveFileId: string; title: string; status: string; lastError: string | null; fileId: string | null };
type Assignment = {
  id: string; title: string; dueDate: string | null; status: string; externalUrl: string | null;
  subjectId: string | null; subject: { id: string; name: string; classroomCourseId: string | null } | null;
  assignmentSourceIds: string[]; nextAction: string; practiceQuestions: PracticeQuestion[];
};
type Payload = { task: Assignment; files: Source[]; sources: Source[]; classroomAttachments: ClassroomAttachment[]; topics: Topic[]; sessions: Session[]; results: Record<string, number> };

export default function AssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Payload | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [action, setAction] = useState("");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [revealed, setRevealed] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/assignments/${id}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load this assignment.");
      const payload = await response.json() as Payload;
      setData(payload);
      setSelected(Array.isArray(payload.task.assignmentSourceIds) ? payload.task.assignmentSourceIds : []);
      setAction(payload.task.nextAction);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load assignment."); }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  const processingAttachments = data?.classroomAttachments.some(({ status }) => ["queued", "uploaded", "processing"].includes(status));
  useEffect(() => {
    if (!processingAttachments) return;
    const controller = new AbortController();
    const deadline = Date.now() + 60_000;
    const timer = window.setInterval(async () => {
      if (Date.now() >= deadline) window.clearInterval(timer);
      try {
        const response = await fetch(`/api/assignments/${id}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const updated = await response.json() as Payload;
        if (controller.signal.aborted) return;
        setData((current) => current?.task.id === id ? { ...current, classroomAttachments: updated.classroomAttachments, sources: updated.sources, files: updated.files } : current);
      } catch {
        // A later poll can recover from a temporary connection issue.
      }
    }, 5000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [id, processingAttachments]);
  useEffect(() => {
    if (!data?.task.subject?.classroomCourseId) return;
    void fetch("/api/integrations/classroom/materials", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => setMaterials((payload?.materials ?? []).filter((item: Material) => item.courseId === data.task.subject?.classroomCourseId)))
      .catch(() => setMaterials([]));
  }, [data?.task.subject?.classroomCourseId]);

  async function request(path: string, method: string, body?: unknown) {
    const response = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message ?? "Action failed. Please retry.");
    return payload;
  }

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label); setError("");
    try { await work(); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Action failed."); }
    finally { setBusy(""); }
  }

  if (!data) return <main className="assignment-page"><p><Link href="/app/tasks">← Tasks</Link></p><p role={error ? "alert" : undefined}>{error || "Loading assignment…"}</p></main>;
  const { task, files, topics, sessions, results, classroomAttachments } = data;
  const automaticFiles = new Set(classroomAttachments.flatMap((file) => file.status === "ready" && file.fileId ? [file.fileId] : []));
  const materialLinks = materials.filter((item) => !classroomAttachments.some((file) => item.driveFileId === file.driveFileId));
  const orderedFiles = [...files].sort((a, b) => Number(b.subjectId === task.subjectId) - Number(a.subjectId === task.subjectId));

  return <main className="assignment-page">
    <p className="assignment-back"><Link href="/app/tasks">← Tasks & planner</Link></p>
    <header className="assignment-head">
      <div><span className="eyebrow">Assignment workspace</span><h1>{task.title}</h1>
        <p>{task.subject?.name ?? "No course"} · {task.dueDate ? `Due ${new Date(task.dueDate).toLocaleDateString()}` : "No due date"} · {task.status === "completed" ? "Completed" : "In progress"}</p></div>
      {task.externalUrl && <a className="button secondary" href={task.externalUrl} target="_blank" rel="noreferrer">Open in Classroom ↗</a>}
    </header>
    {error && <p className="assignment-error" role="alert">{error}</p>}

    <div className="assignment-grid">
      <section className="panel assignment-card">
        <div className="panel-head"><h2>Next action</h2><span className="tag">Your plan</span></div>
        <p className="assignment-help">Write the smallest useful step you can take next.</p>
        <label className="sr-only" htmlFor="assignment-next">Next action</label>
        <textarea id="assignment-next" className="assignment-input" value={action} onChange={(event) => setAction(event.target.value)} maxLength={500} placeholder="Read the brief, outline a solution, or review lecture notes…" />
        <button className="button primary" type="button" disabled={Boolean(busy)} onClick={() => void run("action", async () => { await request(`/api/assignments/${id}`, "PATCH", { nextAction: action }); })}>Save next action</button>
      </section>

      <section className="panel assignment-card">
        <div className="panel-head"><h2>Sources & notes</h2><span className="tag">{selected.length} linked</span></div>
        <p className="assignment-help">Choose the material this assignment should use for grounded practice and answers.</p>
        <div className="assignment-sources">{orderedFiles.length ? orderedFiles.filter((file) => !automaticFiles.has(file.id)).map((file) => <label key={file.id} className="assignment-source">
          <input type="checkbox" checked={selected.includes(file.id)} onChange={() => setSelected((current) => current.includes(file.id) ? current.filter((item) => item !== file.id) : [...current, file.id])} />
          <span><b>{file.name}</b><small>{file.sourceProvider === "classroom" ? "Classroom import" : file.subjectId === task.subjectId ? "Course source" : "Workspace file"}</small></span>
        </label>) : <p>No processed files yet. Add a note or upload course material first.</p>}</div>
        <div className="assignment-actions"><button className="button primary" type="button" disabled={Boolean(busy) || selected.length > 20} onClick={() => void run("sources", async () => { await request(`/api/assignments/${id}`, "PATCH", { sourceIds: selected }); })}>Save sources</button>
          <Link className="button secondary" href="/app/knowledge">Write a note</Link><Link className="button secondary" href="/app/files">Upload file</Link></div>
        {(classroomAttachments.length > 0 || materialLinks.length > 0) && <div className="assignment-materials">
          <h3>Classroom material</h3>
          {classroomAttachments.map((file) => (
            <div className="assignment-material" key={file.id}>
              <span><b>{file.title}</b>{file.lastError && <small className="assignment-help">{file.lastError}</small>}</span>
              <span className="tag">{file.status === "ready" ? "Ready · Linked"
                : file.status === "failed" ? "Needs attention"
                : file.status === "deleted" ? "Removed"
                : file.status === "queued" ? "Queued" : "Processing"}</span>
              {file.status === "failed" && file.fileId && <Link href="/app/files">Open Files &amp; notes</Link>}
            </div>
          ))}
          {materialLinks.length > 0 && <p className="assignment-help">Import supported Drive attachments, then link them above.</p>}
          {materialLinks.slice(0, 12).map((item) => <div className="assignment-material" key={item.id}><span>{item.title}</span><span className="assignment-material-actions">{item.url && <a href={item.url} target="_blank" rel="noreferrer">Open ↗</a>}{item.driveFileId && <button type="button" disabled={Boolean(busy)} onClick={() => void run("import", async () => { await request("/api/integrations/classroom/import", "POST", { driveFileId: item.driveFileId }); })}>Import</button>}</span></div>)}
        </div>}
      </section>
    </div>

    <section className="panel assignment-card assignment-practice"><div className="panel-head"><div><h2>Practice from your sources</h2><p className="assignment-help">Check your answer against the source. Your result updates concept mastery.</p></div>
      <button className="button primary" type="button" disabled={Boolean(busy) || (!selected.length && !automaticFiles.size)} onClick={() => void run("practice", async () => { await request(`/api/assignments/${id}/practice`, "POST"); setRevealed([]); })}>{busy === "practice" ? "Creating…" : task.practiceQuestions.length ? "New practice" : "Make a short quiz"}</button></div>
      {!task.practiceQuestions.length && <p className="assignment-empty">Link a source, then make a short quiz from its excerpts.</p>}
      <div className="assignment-question-grid">{task.practiceQuestions.map((question, index) => <article className="assignment-question" key={question.id}>
        <span className="eyebrow">{String(index + 1).padStart(2, "0")} · {question.concept}</span><h3>{question.q}</h3>
        <p className="assignment-hint">Hint: {question.hint}</p>
        <details><summary>View source excerpt</summary><blockquote>{question.excerpt}</blockquote><small>{question.fileName} · excerpt {question.chunkIndex + 1}</small></details>
        {!revealed.includes(question.id) ? <button className="button secondary" type="button" onClick={() => setRevealed((current) => [...current, question.id])}>Reveal answer</button> : <><p className="assignment-answer"><b>Answer:</b> {question.answer}</p>
          {results[question.id] !== undefined ? <span className="tag">Recorded: {results[question.id] ? "understood" : "needs review"}</span> : <div className="assignment-actions"><button type="button" className="button primary" disabled={Boolean(busy)} onClick={() => void run(question.id, async () => { await request(`/api/assignments/${id}/practice`, "PATCH", { questionId: question.id, correct: true }); })}>I got it</button><button type="button" className="button secondary" disabled={Boolean(busy)} onClick={() => void run(question.id, async () => { await request(`/api/assignments/${id}/practice`, "PATCH", { questionId: question.id, correct: false }); })}>Needs review</button></div>}</>}
      </article>)}</div>
    </section>

    {task.subject && <section className="panel assignment-card"><div className="panel-head"><h2>Learning progress</h2><Link href={`/app/learning/${task.subject.id}`}>Open course →</Link></div>
      <div className="assignment-progress"><div><h3>Concepts</h3>{topics.length ? topics.map((topic) => <p key={topic.id}>{topic.name} <span className="tag">{topic.mastery.replaceAll("_", " ")}</span></p>) : <p>Practice questions to start tracking concepts.</p>}</div>
      <div><h3>Upcoming revision</h3>{sessions.length ? sessions.map((session) => <p key={session.id}>{session.title} <small>{session.scheduledFor ? new Date(session.scheduledFor).toLocaleDateString() : "Unscheduled"}</small></p>) : <p>Missed questions will create a review session.</p>}</div></div>
    </section>}
  </main>;
}
