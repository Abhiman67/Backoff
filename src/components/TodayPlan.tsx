"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type TaskItem = {
  id: string;
  title: string;
  dueDate: string | null;
  priority: string;
  externalUrl: string | null;
  subjectName: string | null;
  projectName: string | null;
};

type RevisionItem = {
  id: string;
  subjectId: string;
  title: string;
  scheduledFor: string | null;
  durationMin: number;
  subjectName: string;
};

type CalendarItem = { id: string; title: string; start: string; end: string; allDay: boolean; link?: string };
type TaskDraft = { title: string; dueDate: string; priority: "low" | "medium" | "high" };

function dateInputValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function taskPriority(value: string): TaskDraft["priority"] {
  if (value === "low" || value === "high") return value;
  return "medium";
}

export function TodayPlan({ tasks: initialTasks, sessions: initialSessions, calendarConnected }: { tasks: TaskItem[]; sessions: RevisionItem[]; calendarConnected: boolean }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [sessions, setSessions] = useState(initialSessions);
  const [events, setEvents] = useState<CalendarItem[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(calendarConnected);
  const [calendarError, setCalendarError] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft>({ title: "", dueDate: "", priority: "medium" });
  const today = new Date();
  const dateLabel = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const overdueCount = tasks.filter((task) => task.dueDate && new Date(task.dueDate).getTime() < new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()).length;

  useEffect(() => {
    if (!calendarConnected) return;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const params = new URLSearchParams({ timeMin: start.toISOString(), timeMax: end.toISOString() });
    let active = true;
    void fetch(`/api/integrations/calendar/events?${params}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message ?? "Calendar events could not be loaded.");
        if (active) setEvents(data.events ?? []);
      })
      .catch((cause) => { if (active) setCalendarError(cause instanceof Error ? cause.message : "Calendar events could not be loaded."); })
      .finally(() => { if (active) setCalendarLoading(false); });
    return () => { active = false; };
  }, [calendarConnected]);

  async function addTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const dueDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 17).toISOString();
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), dueDate, priority: "medium" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Could not add this task.");
      setTasks((current) => [...current, {
        id: data.task.id,
        title: data.task.title,
        dueDate: data.task.dueDate,
        priority: data.task.priority,
        externalUrl: null,
        subjectName: null,
        projectName: null,
      }]);
      setTitle("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add this task.");
    } finally {
      setSaving(false);
    }
  }

  async function completeTask(task: TaskItem) {
    setError("");
    const previous = tasks;
    setTasks((current) => current.filter((item) => item.id !== task.id));
    try {
      const response = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, status: "completed" }),
      });
      if (!response.ok) throw new Error("Could not update this task. It has been restored.");
    } catch (cause) {
      setTasks(previous);
      setError(cause instanceof Error ? cause.message : "Could not update this task.");
    }
  }

  function editTask(task: TaskItem) {
    setEditingTaskId(task.id);
    setTaskDraft({ title: task.title, dueDate: dateInputValue(task.dueDate), priority: taskPriority(task.priority) });
    setError("");
  }

  async function saveTask(task: TaskItem, event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskDraft.title.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const dueDate = taskDraft.dueDate ? new Date(`${taskDraft.dueDate}T17:00:00`).toISOString() : null;
      const response = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, title: taskDraft.title.trim(), dueDate, priority: taskDraft.priority }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Could not save this task.");
      const updated = { ...task, title: data.task.title, dueDate: data.task.dueDate, priority: data.task.priority };
      const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      setTasks((current) => updated.dueDate && new Date(updated.dueDate) < endOfToday
        ? current.map((item) => item.id === updated.id ? updated : item)
        : current.filter((item) => item.id !== updated.id));
      setEditingTaskId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this task.");
    } finally {
      setSaving(false);
    }
  }

  async function completeSession(item: RevisionItem) {
    setError("");
    const previous = sessions;
    setSessions((current) => current.filter((session) => session.id !== item.id));
    try {
      const response = await fetch(`/api/subjects/${item.subjectId}/sessions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, status: "done" }),
      });
      if (!response.ok) throw new Error("Could not update this study session. It has been restored.");
    } catch (cause) {
      setSessions(previous);
      setError(cause instanceof Error ? cause.message : "Could not update this study session.");
    }
  }

  return (
    <main className="today-plan" style={{ maxWidth: 900, margin: "0 auto", paddingBottom: 36 }}>
      <div className="page-head" style={{ alignItems: "end", marginBottom: 22 }}>
        <div>
          <p className="student-home-kicker" style={{ margin: "0 0 8px" }}>{dateLabel}</p>
          <h1 style={{ margin: 0 }}>Today</h1>
          <p style={{ margin: "8px 0 0" }}>One clear plan across coursework, projects, and revision.</p>
        </div>
        <Link href="/app/tasks" className="button secondary sm">Open planner</Link>
      </div>

      <div className="today-plan-summary" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <span className="tag">{tasks.length + sessions.length + events.length} items to move forward</span>
        {overdueCount > 0 && <span className="tag" style={{ color: "#a23627", background: "#f9e6df" }}>{overdueCount} overdue</span>}
        <span className="tag">{sessions.reduce((total, item) => total + item.durationMin, 0)} min planned study</span>
      </div>

      <section className="panel" aria-labelledby="today-add-heading" style={{ marginBottom: 16 }}>
        <h2 id="today-add-heading" style={{ fontSize: 16, margin: "0 0 10px" }}>Add a next step</h2>
        <form className="today-plan-add-form" onSubmit={addTask} style={{ display: "flex", gap: 8 }}>
          <label htmlFor="today-task-title" className="sr-only">Task title</label>
          <input id="today-task-title" className="qa-control" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What do you want to finish today?" maxLength={160} style={{ flex: 1, minWidth: 0 }} />
          <button className="button primary-orange sm" disabled={!title.trim() || saving}>{saving ? "Adding…" : "Add task"}</button>
        </form>
      </section>

      {error && <p role="alert" style={{ color: "#a23627", fontSize: 13 }}>{error}</p>}
      {calendarError && <p role="alert" style={{ color: "#a23627", fontSize: 13 }}>{calendarError} <Link href="/app/settings/integrations">Manage Calendar →</Link></p>}

      <section className="panel today-plan-list" aria-labelledby="today-list-heading">
        <div className="panel-head"><h2 id="today-list-heading">Your plan</h2><span className="tag">Updates as you complete work</span></div>
        {tasks.length === 0 && sessions.length === 0 ? (
          <div className="today-empty" style={{ textAlign: "center", padding: "28px 12px" }}>
            <h3 style={{ margin: "0 0 6px" }}>A little room to breathe.</h3>
            <p style={{ color: "var(--color-muted)", margin: "0 0 14px" }}>No tasks or revision sessions are due today. Add a task or review your courses.</p>
            <Link href="/app/learning" className="button secondary sm">Review courses</Link>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {tasks.map((task) => {
              const overdue = Boolean(task.dueDate && new Date(task.dueDate).getTime() < new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime());
              return (
                <article key={task.id} className="today-plan-item" style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid var(--color-line)", borderRadius: 14, padding: "12px 14px" }}>
                  <button type="button" className="button secondary sm" aria-label={`Mark ${task.title} complete`} onClick={() => void completeTask(task)}>✓</button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {editingTaskId === task.id ? (
                      <form className="today-task-edit-form" onSubmit={(event) => void saveTask(task, event)}>
                        <label><span>Task</span><input className="qa-control" value={taskDraft.title} onChange={(event) => setTaskDraft((draft) => ({ ...draft, title: event.target.value }))} maxLength={200} required /></label>
                        <label><span>Due date</span><input className="qa-control" type="date" value={taskDraft.dueDate} onChange={(event) => setTaskDraft((draft) => ({ ...draft, dueDate: event.target.value }))} /></label>
                        <label><span>Priority</span><select className="qa-control" value={taskDraft.priority} onChange={(event) => setTaskDraft((draft) => ({ ...draft, priority: taskPriority(event.target.value) }))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
                        <div className="today-task-edit-actions"><button type="submit" className="button primary-orange sm" disabled={saving}>{saving ? "Saving…" : "Save"}</button><button type="button" className="button secondary sm" onClick={() => setEditingTaskId(null)} disabled={saving}>Cancel</button></div>
                      </form>
                    ) : <>
                      <strong>{task.title}</strong>
                      <p style={{ margin: "4px 0 0", color: "var(--color-muted)", fontSize: 12 }}>{[task.subjectName, task.projectName, overdue ? "Overdue" : "Due today", task.priority].filter(Boolean).join(" · ")}</p>
                    </>}
                  </div>
                  {task.externalUrl && <a className="button secondary sm" href={task.externalUrl} target="_blank" rel="noreferrer">Open source ↗</a>}
                  {editingTaskId !== task.id && <button type="button" className="button secondary sm" onClick={() => editTask(task)} aria-label={`Edit ${task.title}`}>Edit</button>}
                </article>
              );
            })}
            {sessions.map((item) => (
              <article key={item.id} className="today-plan-item" style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid var(--color-line)", borderRadius: 14, padding: "12px 14px" }}>
                <button type="button" className="button secondary sm" aria-label={`Mark ${item.title} complete`} onClick={() => void completeSession(item)}>✓</button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{item.title}</strong>
                  <p style={{ margin: "4px 0 0", color: "var(--color-muted)", fontSize: 12 }}>{item.subjectName} · {item.durationMin} min · Revision</p>
                </div>
                <Link className="button secondary sm" href={`/app/learning/${item.subjectId}`}>Study ↗</Link>
              </article>
            ))}
          </div>
        )}
      </section>

      {calendarConnected && (
        <section className="panel" aria-labelledby="calendar-events-heading" style={{ marginTop: 16 }}>
          <div className="panel-head"><h2 id="calendar-events-heading">Today&apos;s calendar</h2><Link href="/app/settings/integrations">Manage connection →</Link></div>
          {calendarLoading && <p style={{ color: "var(--color-muted)", fontSize: 13 }}>Loading your Google Calendar…</p>}
          {!calendarLoading && !calendarError && events.length === 0 && <p style={{ color: "var(--color-muted)", fontSize: 13 }}>No calendar events today.</p>}
          {!calendarLoading && events.map((event) => {
            const startsAt = event.allDay ? "All day" : new Date(event.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
            const endsAt = event.allDay ? "" : new Date(event.end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
            return (
              <article key={event.id} className="today-plan-item" style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid var(--color-line)", borderRadius: 14, padding: "12px 14px", marginTop: 8 }}>
                <span className="tag" style={{ flexShrink: 0 }}>{startsAt}</span>
                <div style={{ flex: 1, minWidth: 0 }}><strong>{event.title}</strong>{endsAt && <p style={{ margin: "4px 0 0", color: "var(--color-muted)", fontSize: 12 }}>Until {endsAt}</p>}</div>
                {event.link && <a className="button secondary sm" href={event.link} target="_blank" rel="noreferrer">Open event ↗</a>}
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
