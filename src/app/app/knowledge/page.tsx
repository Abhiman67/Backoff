"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Dropdown from "@/components/Dropdown";
import { EmptyState, ErrorState } from "@/components/states";

type Option = { id: string; name?: string; title?: string };
type Note = { id: string; name: string; size: number; textContent?: string; subjectId?: string | null; projectId?: string | null; careerGoalId?: string | null; tags?: string[]; folder?: string };

export default function KnowledgePage() {
  const [notes, setNotes] = useState<Note[]>([]), [files, setFiles] = useState<Note[]>([]), [subjects, setSubjects] = useState<Option[]>([]), [projects, setProjects] = useState<Option[]>([]), [goals, setGoals] = useState<Option[]>([]);
  const [active, setActive] = useState<Note | null>(null), [title, setTitle] = useState(""), [content, setContent] = useState(""), [tags, setTags] = useState(""), [folder, setFolder] = useState("Inbox"), [revisions, setRevisions] = useState<{ id: string; title: string; content: string; createdAt: string }[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(""), [saving, setSaving] = useState(false);
  const [search, setSearch] = useState(""), [searchLoading, setSearchLoading] = useState(false), [noteCount, setNoteCount] = useState(0), [nextCursor, setNextCursor] = useState<string | null>(null), [importing, setImporting] = useState(false), [exporting, setExporting] = useState(false), [importMessage, setImportMessage] = useState("");
  const [creatingFromFile, setCreatingFromFile] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const hydrated = useRef<string | null>(null);
  const baseline = useRef<{ id: string; title: string; content: string; tags: string; folder: string } | null>(null);
  const searchTerm = useRef("");
  const templateApplied = useRef(false);
  const deepLinkOpened = useRef(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function options<T>(url: string, key: string, apply: (items: T[]) => void) {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error();
        apply((await response.json())[key]);
      } catch {
        if (!controller.signal.aborted) setError("Could not load " + key + ".");
      }
    }
    void options("/api/files?view=options&take=6", "files", setFiles);
    void options("/api/subjects?view=options", "subjects", setSubjects);
    void options("/api/projects?view=options", "projects", setProjects);
    void options("/api/career/goals", "goals", setGoals);
    return () => controller.abort();
  }, [reload]);
  function open(n: Note) {
    const noteTitle = n.name.replace(/\.md$/, "");
    const noteContent = n.textContent ?? "";
    const noteTags = (n.tags ?? []).join(", ");
    const noteFolder = n.folder ?? "Inbox";
    setActive(n); setTitle(noteTitle); setContent(noteContent); setTags(noteTags); setFolder(noteFolder); setRevisions([]);
    hydrated.current = n.id;
    baseline.current = n.textContent === undefined ? null : { id: n.id, title: noteTitle, content: noteContent, tags: noteTags, folder: noteFolder };
    if (n.textContent === undefined) {
      void fetch(`/api/notes/${n.id}?format=json`).then(async (response) => {
        if (!response.ok) throw new Error("Could not open this note.");
        return (await response.json()).note as Note;
      }).then((loadedNote) => {
        if (hydrated.current !== n.id) return;
        const loadedContent = loadedNote.textContent ?? "";
        setContent(loadedContent);
        baseline.current = { id: n.id, title: noteTitle, content: loadedContent, tags: noteTags, folder: noteFolder };
      }).catch((cause) => { if (hydrated.current === n.id) setError(cause instanceof Error ? cause.message : "Could not open this note."); });
    }
    void fetch(`/api/notes/${n.id}/revisions`).then((r) => r.ok ? r.json() : { revisions: [] }).then((d) => { if (hydrated.current === n.id) setRevisions(d.revisions ?? []); });
  }
  async function create(body = "# Untitled note\n\nStart writing…", name = "Untitled note") { const r = await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: name, content: body }) }); if (!r.ok) return setError("Could not create note."); const n = (await r.json()).note as Note; setSearch(""); setNotes((x) => [n, ...x]); setNoteCount((count) => count + 1); open(n); }
  useEffect(() => {
    if (loading || deepLinkOpened.current) return;
    deepLinkOpened.current = true;
    const noteId = new URLSearchParams(window.location.search).get("note");
    if (!noteId) return;
    window.history.replaceState({}, "", "/app/knowledge");
    const existing = notes.find((note) => note.id === noteId);
    if (existing) { void Promise.resolve().then(() => open(existing)); return; }
    void fetch(`/api/notes/${encodeURIComponent(noteId)}?format=json`).then(async (response) => {
      if (!response.ok) throw new Error("That linked note could not be found.");
      return (await response.json()).note as Note;
    }).then((note) => open(note)).catch((cause) => setError(cause instanceof Error ? cause.message : "That linked note could not be found."));
  }, [loading, notes]);
  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      void fetch(`/api/notes?take=100&q=${encodeURIComponent(search.trim())}`, { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error("Could not search your notes.");
        return response.json();
      }).then((data) => {
        if (!current) return;
        setNotes(data.notes ?? []); setNoteCount(data.total ?? 0); setNextCursor(data.nextCursor ?? null);
      }).catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : "Could not search your notes."); }).finally(() => { if (current) { setSearchLoading(false); setLoading(false); } });
    }, search ? 220 : 0);
    return () => { current = false; window.clearTimeout(timer); };
  }, [search, reload]);
  useEffect(() => {
    if (loading || templateApplied.current) return;
    const template = new URLSearchParams(window.location.search).get("template");
    if (!template) return;
    templateApplied.current = true;
    const timer = window.setTimeout(() => void create(template, "New note"), 0);
    window.history.replaceState({}, "", "/app/knowledge");
    return () => window.clearTimeout(timer);
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    if (!active || !title.trim()) return;
    setSaving(true);
    const savedFields = { id: active.id, title, content, tags, folder };
    const r = await fetch(`/api/notes/${active.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, content, folder, tags: tags.split(",").map((x) => x.trim()).filter(Boolean) }) });
    if (r.ok) {
      const n = (await r.json()).note as Note;
      setNotes((x) => x.map((v) => v.id === n.id ? { ...n, textContent: content } : v));
      setActive({ ...n, textContent: content });
      baseline.current = savedFields;
    } else setError("Could not save note.");
    setSaving(false);
  }
  useEffect(() => {
    const saved = baseline.current;
    if (!active || hydrated.current !== active.id || !saved || saved.id !== active.id) return;
    if (saved.title === title && saved.content === content && saved.tags === tags && saved.folder === folder) return;
    const t = window.setTimeout(() => void save(), 900);
    return () => window.clearTimeout(t);
  }, [title, content, tags, folder, active]); // eslint-disable-line react-hooks/exhaustive-deps
  async function loadMore() {
    if (!nextCursor || searchLoading) return;
    const query = search.trim();
    const params = new URLSearchParams({ take: "100", cursor: nextCursor, q: query });
    setSearchLoading(true);
    try {
      const response = await fetch(`/api/notes?${params}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Could not load more notes.");
      if (searchTerm.current !== query) return;
      setNotes((current) => {
        const existing = new Set(current.map((note) => note.id));
        return [...current, ...(data.notes as Note[]).filter((note) => !existing.has(note.id))];
      });
      setNextCursor(data.nextCursor ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load more notes."); }
    finally { setSearchLoading(false); }
  }
  async function attach(field: "subjectId" | "projectId" | "careerGoalId", value: string) { if (!active) return; const n = { ...active, [field]: value || null }; setActive(n); setNotes((x) => x.map((v) => v.id === n.id ? n : v)); await fetch(`/api/notes/${n.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: value || null }) }); }
  async function importFiles(selected: FileList | null) {
    if (!selected?.length) return;
    const form = new FormData();
    for (const file of Array.from(selected)) form.append("files", file);
    setImporting(true); setError(""); setImportMessage("");
    try {
      const response = await fetch("/api/notes/import", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Could not import these notes.");
      const imported = data.notes as Note[];
      setNotes((current) => [...imported, ...current]);
      setNoteCount((count) => count + imported.length);
      setSearch("");
      setImportMessage(`${data.imported} ${data.imported === 1 ? "note" : "notes"} imported${data.skipped ? `; ${data.skipped} duplicate ${data.skipped === 1 ? "note was" : "notes were"} skipped` : ""}.`);
      if (imported[0]) open(imported[0]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import these notes.");
    } finally {
      setImporting(false);
      if (importInput.current) importInput.current.value = "";
    }
  }
  async function createFromFile(file: Note) {
    setCreatingFromFile(file.id); setError(""); setImportMessage("");
    try {
      let source = file;
      if (source.textContent === undefined) {
        const response = await fetch(`/api/files/${file.id}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message ?? "Could not read this source file.");
        source = data.file as Note;
      }
      const sourceText = source.textContent?.trim();
      if (!sourceText) throw new Error("This file has no extracted text yet. Run OCR from Files & notes, then try again.");
      const response = await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: file.name.replace(/\.[^.]+$/, "").slice(0, 160), content: sourceText, folder: "Course notes", tags: ["source file"] }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Could not create a note from this file.");
      const note = data.note as Note;
      setNotes((current) => [note, ...current]); setNoteCount((count) => count + 1); setSearch(""); open(note);
      setImportMessage(`Created a note from ${file.name}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a note from this file.");
    } finally { setCreatingFromFile(null); }
  }
  async function exportNotes() {
    setExporting(true); setError(""); setImportMessage("");
    try {
      const response = await fetch("/api/notes/export", { cache: "no-store" });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message ?? "Could not export your notes.");
      }
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = "vidyasarthi-notes-export.json";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setImportMessage("Notes backup downloaded.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export your notes.");
    } finally { setExporting(false); }
  }
  if (loading) return <main className="p-8"><div className="panel">Reading your notes…</div></main>;
  if (error && !notes.length && !files.length) return <main className="p-8"><ErrorState message={error} retry={() => { setError(""); setReload(value => value + 1); }} /></main>;
  const query = search.trim();
  const visibleNotes = notes;
  const picker = <div className="note-context-row"><Dropdown value={active?.subjectId ?? ""} onChange={(v) => void attach("subjectId", v)} label="Course" options={[{ value: "", label: "No course" }, ...subjects.map((x) => ({ value: x.id, label: x.name ?? "Course" }))]} /><Dropdown value={active?.projectId ?? ""} onChange={(v) => void attach("projectId", v)} label="Project" options={[{ value: "", label: "No project" }, ...projects.map((x) => ({ value: x.id, label: x.name ?? "Project" }))]} /><Dropdown value={active?.careerGoalId ?? ""} onChange={(v) => void attach("careerGoalId", v)} label="Career goal" options={[{ value: "", label: "No career goal" }, ...goals.map((x) => ({ value: x.id, label: x.title ?? "Career goal" }))]} /></div>;
  return <main style={{ maxWidth: 980, margin: "0 auto", paddingBottom: 40 }}>
    <div className="page-head"><div><h1>Knowledge</h1><p>Capture what you learn, connect it to context, and turn it into practice.</p></div><div className="knowledge-page-actions"><Link className="button secondary sm" href="/app/knowledge/graph">Note graph</Link><Link className="button secondary sm" href="/app/knowledge/folders">Folders &amp; tags</Link><Link className="button secondary sm" href={active ? `/app/knowledge/${active.id}/history` : "/app/knowledge/templates"}>{active ? "History" : "Templates"}</Link><button className="button secondary sm" type="button" onClick={() => void exportNotes()} disabled={exporting}>{exporting ? "Exporting…" : "Export backup"}</button><button className="button secondary sm" type="button" onClick={() => importInput.current?.click()} disabled={importing}>{importing ? "Importing…" : "Import notes"}</button><input ref={importInput} type="file" accept=".md,.markdown,.json,text/markdown,application/json" multiple onChange={(event) => void importFiles(event.target.files)} aria-label="Import Markdown notes or a VidyaSarthi notes backup" hidden /><button className="button primary sm" type="button" onClick={() => void create()}>New note</button></div></div>
    {(error || importMessage) && <p className={error ? "knowledge-message is-error" : "knowledge-message"} role={error ? "alert" : "status"}>{error || importMessage}</p>}
    <section className="panel knowledge-search"><label htmlFor="knowledge-search-input">Search your notes</label><input id="knowledge-search-input" className="qa-control" type="search" value={search} onChange={(event) => { const value = event.target.value; searchTerm.current = value.trim(); setSearch(value); }} placeholder="Search titles, content, folders, or tags…" /><span aria-live="polite">{searchLoading ? "Searching…" : `${notes.length} of ${noteCount} notes`}</span></section>
    <section className="knowledge-workspace"><div className="panel knowledge-notes-list"><div className="panel-head"><h2>Your notes</h2><span>{visibleNotes.length}</span></div>{visibleNotes.length ? visibleNotes.map((n) => <button className={`note-list-item${active?.id === n.id ? " active" : ""}`} type="button" key={n.id} onClick={() => open(n)}><b>{n.name.replace(/\.md$/, "")}</b><span>{Math.max(1, Math.round(n.size / 1024))} KB</span></button>) : <EmptyState title={query ? "No matching notes" : "Start with one note"} body={query ? "Try another phrase in your notes." : "Create a note above, import Markdown, or turn one of your source files below into editable notes."} />}{nextCursor && <button className="button secondary sm" type="button" onClick={() => void loadMore()} disabled={searchLoading} style={{ width: "100%", marginTop: 10 }}>{searchLoading ? "Loading…" : "Load more notes"}</button>}</div><div className="panel note-editor">{active ? <><input className="note-title-input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Note title" />{picker}<input className="note-tags-input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, comma separated" aria-label="Note tags" /><div className="note-actions"><Link className="button secondary sm" href={`/app/agents?q=${encodeURIComponent(`Use ${title} as your source and cite it: ${content.slice(0, 800)}`)}`}>Explain</Link><Link className="button secondary sm" href={`/app/agents?q=${encodeURIComponent(`Quiz me on ${title}: ${content.slice(0, 800)}`)}`}>Quiz me</Link><Link className="button secondary sm" href={`/app/agents?q=${encodeURIComponent(`Make a study plan from ${title}: ${content.slice(0, 800)}`)}`}>Make a plan</Link><a className="button secondary sm" href={`/api/notes/${active.id}`}>Export Markdown</a></div><textarea className="note-editor-input" value={content} onChange={(e) => setContent(e.target.value)} aria-label="Note content" /><div className="note-editor-footer"><span>Markdown · autosaved</span><button className="button primary sm" type="button" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save note"}</button></div></> : <EmptyState title="Choose a note" body="Select a note or create one to start capturing what you learn." />}</div></section><section className="panel" style={{ marginTop: 16 }}><div className="panel-head"><h2>Source files</h2><Link href="/app/files">Manage files →</Link></div>{files.length ? files.slice(0, 6).map((f) => <div key={f.id} className="focus"><div className="agent-icon yellow">◒</div><div className="focus-body"><b>{f.name}</b><p>{Math.max(1, Math.round(f.size / 1024))} KB · source material</p></div><div className="knowledge-source-actions"><Link className="button secondary sm" href="/app/files">Open file</Link><button className="button primary sm" type="button" onClick={() => void createFromFile(f)} disabled={creatingFromFile === f.id}>{creatingFromFile === f.id ? "Creating…" : "Create note"}</button></div></div>) : <EmptyState title="No source files yet" body="Upload notes or slides so Study Coach can ground answers." />}</section>
  </main>;
}
