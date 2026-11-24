"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ClassroomCourse, ClassroomMaterial } from "@/lib/integrations/classroom";
import { AttachNotesDialog } from "@/components/AttachNotesDialog";
import type { ChatAttachment } from "@/lib/chat-attachments";

interface ClassroomDashboardProps {
  defaultCourses?: ClassroomCourse[];
  agentsCount?: number;
  studyCoachId?: string;
  isConnected?: boolean;
}

export function ClassroomDashboard({
  defaultCourses,
  studyCoachId,
  isConnected = false,
}: ClassroomDashboardProps) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [showAttachments, setShowAttachments] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const sending = useRef(false);
  const pendingDraft = useRef<{ agentId: string; conversationId: string; message: string; attachmentIds: string[]; turnId: string } | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectedState, setConnectedState] = useState(isConnected);
  const [courses, setCourses] = useState<ClassroomCourse[]>(defaultCourses ?? []);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDemo, setIsDemo] = useState(!isConnected);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [materials, setMaterials] = useState<ClassroomMaterial[]>([]);
  const [materialsMessage, setMaterialsMessage] = useState("");
  const [importingFile, setImportingFile] = useState("");
  const [importedFiles, setImportedFiles] = useState<string[]>([]);
  const [importFileStatuses, setImportFileStatuses] = useState<Record<string, string>>({});
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [lastSyncError, setLastSyncError] = useState("");

  useEffect(() => {
    if (!connectedState) return;
    void fetch("/api/integrations/classroom", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((status) => { if (status?.lastSyncedAt) setLastSyncedAt(status.lastSyncedAt); if (status?.lastSyncError) setLastSyncError(status.lastSyncError); })
      .catch(() => undefined);
  }, [connectedState]);

  useEffect(() => {
    if (!connectedState || defaultCourses) return;
    let cancelled = false;
    async function loadCoursesAndTasks() {
      setIsSyncing(true);
      setError("");
      try {
        const coursesResponse = await fetch("/api/integrations/classroom/courses", { cache: "no-store" });
        const coursesData = await coursesResponse.json();
        if (!coursesResponse.ok) throw new Error(coursesData.error?.message ?? "Could not sync courses.");
        const data = coursesData as { courses?: ClassroomCourse[]; demo?: boolean };
        if (!cancelled) {
          setCourses(data.courses ?? []);
          setIsDemo(Boolean(data.demo));
        }
        const syncResponse = await fetch("/api/integrations/classroom/sync", { method: "POST" });
        const syncData = await syncResponse.json();
        if (!syncResponse.ok) throw new Error(syncData.error?.message ?? "Coursework could not be added to your plan.");
        if (!cancelled) setSyncMessage(`${syncData.synced ?? 0} coursework items synced to your plan.`);
        if (!cancelled) { setLastSyncedAt(new Date().toISOString()); setLastSyncError(""); }
        const materialsResponse = await fetch("/api/integrations/classroom/materials", { cache: "no-store" });
        const materialsData = await materialsResponse.json();
        if (!materialsResponse.ok) {
          if (!cancelled) setMaterialsMessage(materialsData.error?.message ?? "Course materials could not be loaded.");
        } else if (!cancelled) {
          setMaterials(materialsData.materials ?? []);
          setImportedFiles(materialsData.importedDriveFileIds ?? []);
          setImportFileStatuses(Object.fromEntries((materialsData.importedFiles ?? []).map((file: { driveFileId: string; status: string }) => [file.driveFileId, file.status])));
          setMaterialsMessage(materialsData.restrictedCourseCount ? `Google restricted standalone materials in ${materialsData.restrictedCourseCount} course(s). Assignment attachments may still appear here.` : "");
        }
      } catch (cause) {
        if (!cancelled) {
          const message = cause instanceof Error ? cause.message : "Courses could not be synced. Try reconnecting Classroom.";
          setError(message);
          setLastSyncError(message);
        }
      } finally {
        if (!cancelled) setIsSyncing(false);
      }
    }
    void loadCoursesAndTasks();
    return () => { cancelled = true; };
  }, [connectedState, defaultCourses]);

  async function importClassroomFile(driveFileId: string) {
    if (importingFile) return;
    setImportingFile(driveFileId);
    setMaterialsMessage("");
    try {
      const response = await fetch("/api/integrations/classroom/import", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ driveFileId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Could not import this Classroom file.");
      let fileStatus: string = data.file.status;
      if (["uploaded", "processing"].includes(fileStatus) && data.file.id) {
        for (let attempt = 0; attempt < 5 && ["uploaded", "processing"].includes(fileStatus); attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1200));
          const fileResponse = await fetch(`/api/files/${data.file.id}`, { cache: "no-store" });
          const fileData = await fileResponse.json();
          if (fileResponse.ok) fileStatus = fileData.file.status;
        }
      }
      setImportFileStatuses((current) => ({ ...current, [driveFileId]: fileStatus }));
      setImportedFiles((current) => fileStatus === "failed" ? current.filter((id) => id !== driveFileId) : current.includes(driveFileId) ? current : [...current, driveFileId]);
      setMaterialsMessage(fileStatus === "ready" ? "File is ready in Files & notes." : fileStatus === "failed" ? "The file was imported but could not be processed. Retry it here or check Files & notes." : data.alreadyImported ? "File processing restarted. It will appear in Files & notes when ready." : "File imported. VidyaSarthi is preparing it for your notes and agents.");
    } catch (cause) {
      setMaterialsMessage(cause instanceof Error ? cause.message : "Could not import this Classroom file.");
    } finally {
      setImportingFile("");
    }
  }

  async function handleSyncTasks() {
    if (isSyncing) return;
    setIsSyncing(true);
    setError("");
    setSyncMessage("");
    try {
      const response = await fetch("/api/integrations/classroom/sync", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Coursework could not be synced.");
      setSyncMessage(`${data.synced ?? 0} coursework items synced to your plan. ${data.notified ?? 0} new notifications.`);
      setLastSyncedAt(new Date().toISOString());
      setLastSyncError("");
      router.refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Coursework could not be synced. Try again.";
      setError(message);
      setLastSyncError(message);
    } finally {
      setIsSyncing(false);
    }
  }

  const promptChips = [
    { label: "What do I have due this week?", glyph: "✓" },
    { label: "Explain this assignment", glyph: "◒" },
    { label: "Make a study plan", glyph: "⌘" },
    { label: "Summarize my lecture notes", glyph: "↥" },
  ];

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = prompt.trim();
    if (!message || sending.current) return;
    sending.current = true;
    setIsSending(true);
    setSendError("");
    const attachmentIds = attachments.map(({ id }) => id);
    try {
      let draft = pendingDraft.current;
      if (!draft || draft.message !== message || JSON.stringify(draft.attachmentIds) !== JSON.stringify(attachmentIds)) {
        let agentId = studyCoachId;
        if (!agentId) {
          const setup = await fetch("/api/agents/ensure", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goals: ["Improve grades"] }),
          });
          if (!setup.ok) throw new Error("Could not set up Study Coach.");
          const agents = await fetch("/api/agents", { cache: "no-store" });
          if (!agents.ok) throw new Error("Could not open Study Coach.");
          const data: { agents: { id: string; template: string }[] } = await agents.json();
          agentId = data.agents.find((item) => item.template === "study-coach")?.id;
          if (!agentId) throw new Error("Study Coach is unavailable. Try again.");
        }
        const response = await fetch("/api/conversations", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId }),
        });
        if (!response.ok) throw new Error("Could not start a conversation.");
        const { conversation }: { conversation: { id: string } } = await response.json();
        draft = { agentId, conversationId: conversation.id, message, attachmentIds, turnId: crypto.randomUUID() };
        pendingDraft.current = draft;
      }
      const response = await fetch(`/api/conversations/${draft.conversationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, attachmentIds, turnId: draft.turnId }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const data: { error?: { message?: string } } = await response.json().catch(() => ({}));
        throw new Error(data.error?.message ?? "Could not send your question.");
      }
      const handoff = new URLSearchParams({ agent: draft.agentId, conversation: draft.conversationId });
      pendingDraft.current = null;
      setPrompt("");
      setAttachments([]);
      router.push(`/app/agents?${handoff}`);
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : "Could not send your question. Try again.");
    } finally {
      sending.current = false;
      setIsSending(false);
    }
  }

  const handleConnect = async () => {
    setIsConnecting(true);
    setError("");
    try {
      const res = await fetch("/api/integrations/classroom/connect", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Google Classroom OAuth is not configured yet.");
      if (typeof data.authUrl !== "string") throw new Error("Google did not provide an authorization link.");
      window.location.assign(data.authUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Classroom connection failed. Try again from Settings → Integrations.");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDictate = () => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setError("Voice input isn't supported in this browser. Type instead.");
      return;
    }
    try {
      const rec: SpeechRecognitionInstance = new Ctor();
      rec.lang = "en-US";
      rec.interimResults = false;
      rec.onresult = (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
        const text = Array.from(e.results)
          .map((r) => r[0]?.transcript ?? "")
          .join(" ")
          .trim();
        if (text) setPrompt((p) => (p ? `${p} ${text}` : text));
      };
      rec.onerror = () => setListening(false);
      rec.onend = () => setListening(false);
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  return (
    <div className="grok-dashboard-container">
      {error && (
        <p role="alert" style={{ fontSize: 13, color: "#c0392b", margin: "0 0 12px" }}>{error}</p>
      )}
      {syncMessage && <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--color-muted)", margin: "0 0 12px" }}>{syncMessage}</p>}

      {/* 1. Suggested starters */}
      <div className="grok-chips-row">
        {promptChips.map((chip) => (
          <button
            key={chip.label}
            type="button"
            className="grok-chip"
            disabled={isSending}
            onClick={() => setPrompt(chip.label)}
          >
            <span className="grok-chip-icon" aria-hidden="true">{chip.glyph}</span>
            <span>{chip.label}</span>
          </button>
        ))}
      </div>

      {/* 2. Ask box — sends to Study Coach */}
      <section className="grok-omnibar-wrapper">
        <form onSubmit={handleSend} className="grok-omnibar">
          <div className="grok-omnibar-input-row">
            <label className="sr-only" htmlFor="copilot-ask">Ask VidyaSarthi</label>
            <input
              id="copilot-ask"
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Tell VidyaSarthi what you&apos;re trying to move forward…"
              className="grok-omnibar-input"
              maxLength={4000}
              disabled={isSending}
            />
            <div className="grok-omnibar-actions">
              <button
                type="button"
                className="grok-icon-btn"
                title={listening ? "Stop listening" : "Dictate with your voice"}
                aria-label={listening ? "Stop listening" : "Dictate with your voice"}
                aria-pressed={listening}
                onClick={handleDictate}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                </svg>
              </button>
              <button
                type="submit"
                disabled={!prompt.trim() || isSending}
                className={`grok-send-btn ${prompt.trim() ? "active" : ""}`}
                title="Ask VidyaSarthi"
                aria-label="Ask VidyaSarthi"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="grok-omnibar-toggles">
            <div className="grok-toggles-left">
              <button
                type="button"
                className="grok-toggle-pill"
                disabled={isSending}
                onClick={() => setShowAttachments(true)}
              >
                <span aria-hidden="true">+</span>
                <span>Attach notes</span>
              </button>
              {attachments.map((file) => (
                <button className="grok-toggle-pill active-green" type="button" key={file.id} disabled={isSending}
                  aria-label={`Remove ${file.name}`} onClick={() => setAttachments((items) => items.filter((item) => item.id !== file.id))}>
                  <span>{file.name}</span><span aria-hidden="true">×</span>
                </button>
              ))}
            </div>
            <span className="grok-disclaimer">
              Answers may be wrong. Verify against your course material.
            </span>
          </div>
        </form>
        {isSending && <p className="omnibar-feedback" role="status">Opening your chat…</p>}
        {sendError && <p className="omnibar-feedback files-error" role="alert">{sendError}</p>}
        {showAttachments && <AttachNotesDialog selected={attachments} onClose={() => setShowAttachments(false)}
          onApply={(files) => { setAttachments(files); setShowAttachments(false); }} />}
      </section>

      {/* 3. Courses — live connection or clearly-labeled demo */}
      {!connectedState ? (
        <section className="grok-classroom-section">
          <div className="grok-classroom-header">
            <div className="grok-classroom-title-group">
              <div>
                <h2>Connect Google Classroom</h2>
                <p className="grok-section-sub">
                  Bring your college courses and deadlines into VidyaSarthi with read-only access.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={isConnecting}
              className="grok-sync-btn"
            >
              {isConnecting ? "Connecting…" : "Connect Classroom"}
            </button>
          </div>
        </section>
      ) : (
        <section className="grok-classroom-section">
          <div className="grok-classroom-header">
            <div className="grok-classroom-title-group">
              <div className="classroom-icon-badge">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect width="24" height="24" rx="4" fill="#0F9D58" />
                  <path d="M12 6L4 11V13L12 8L20 13V11L12 6Z" fill="white" />
                  <path d="M7 13.5V17C7 18.1 9.2 19 12 19C14.8 19 17 18.1 17 17V13.5L12 16.5L7 13.5Z" fill="#F4B400" />
                </svg>
              </div>
              <div>
                <h2>Your courses</h2>
                <p className="grok-section-sub">
                  Connection active · <span className="tag" style={{ fontSize: 10 }}>{isSyncing ? "Syncing…" : isDemo ? "Preview courses" : "Read-only sync"}</span>{lastSyncedAt && <> · Last synced {new Date(lastSyncedAt).toLocaleString()}</>}
                </p>
                {lastSyncError && <p role="alert" className="classroom-materials-message">Latest sync failed: {lastSyncError}. Your saved tasks were not replaced.</p>}
              </div>
            </div>
            <div className="grok-classroom-header-actions">
              <button type="button" className="grok-sync-btn" onClick={() => void handleSyncTasks()} disabled={isSyncing}>{isSyncing ? "Syncing…" : "Sync tasks"}</button>
              <Link href="/app/settings/integrations" className="grok-view-all">
                Manage connection →
              </Link>
              <Link href="/app/tasks" className="grok-view-all">
                View all →
              </Link>
            </div>
          </div>

          <div className="grok-courses-grid">
            {courses.slice(0, 8).map((course) => (
              <div key={course.id} className={`grok-course-card color-${course.colorScheme}`}>
                <div className="course-card-top">
                  <div>
                    <span className="course-section-badge">{course.section}</span>
                    <h4 className="course-title"><Link href={`/app/classroom/${encodeURIComponent(course.id)}`}>{course.name}</Link></h4>
                    <span className="course-instructor">{course.instructor}</span>
                  </div>
                  <div className="course-corner-icon" aria-hidden="true">✦</div>
                </div>

                <div className="course-items-list">
                  {course.assignments.map((item) => (
                    <div
                      key={item.id}
                      className="course-item-row"
                      onClick={() => setPrompt(`Explain ${item.title} for ${course.name}`)}
                      title={`Ask about ${item.title}`}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") setPrompt(`Explain ${item.title} for ${course.name}`);
                      }}
                    >
                      <div className="course-item-left">
                        <span className={`course-status-bullet bullet-${item.status}`} />
                        <span className="course-item-title">{item.title}</span>
                      </div>
                      {item.dueText && (
                        <span className={`course-due-tag tag-${item.status}`}>
                          {item.dueText}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                <div className="course-card-footer">
                  <Link href={`/app/classroom/${encodeURIComponent(course.id)}`} className="course-action-link">
                    Open course →
                  </Link>
                  <button
                    type="button"
                    onClick={() => setPrompt(`Generate a revision plan and flashcards for ${course.name}`)}
                    className="course-action-link"
                  >
                    Generate study plan ↗
                  </button>
                </div>
              </div>
            ))}
          </div>
          {courses.length === 0 && !isSyncing && !error && <p style={{ color: "var(--color-muted)", fontSize: 13 }}>No active courses found for the connected Google account. Make sure it is enrolled in a Classroom course.</p>}
          {courses.length > 8 && <p style={{ color: "var(--color-muted)", fontSize: 12 }}>Showing 8 of {courses.length} courses. Tasks from all courses are included in your planner.</p>}
          <div className="classroom-materials-block">
            <div className="classroom-materials-heading">
              <div><h3>Course materials</h3><p>Files, links, videos, and forms shared in your courses.</p></div>
              <button type="button" className="grok-sync-btn" disabled={isSyncing} onClick={async () => {
                setMaterialsMessage("");
                try {
                  const response = await fetch("/api/integrations/classroom/materials", { cache: "no-store" });
                  const data = await response.json();
                  if (!response.ok) throw new Error(data.error?.message ?? "Materials could not be refreshed.");
                  setMaterials(data.materials ?? []);
                  setImportedFiles(data.importedDriveFileIds ?? []);
                  setImportFileStatuses(Object.fromEntries((data.importedFiles ?? []).map((file: { driveFileId: string; status: string }) => [file.driveFileId, file.status])));
                } catch (cause) { setMaterialsMessage(cause instanceof Error ? cause.message : "Materials could not be refreshed."); }
              }}>Refresh materials</button>
            </div>
            {materialsMessage && <p role="status" aria-live="polite" className="classroom-materials-message">{materialsMessage}{(materialsMessage.includes("Reconnect Google Classroom") || materialsMessage.includes("Connect Google Drive") || materialsMessage.includes("Reconnect Drive")) && <> <Link href="/app/settings/integrations">Manage connections →</Link></>}</p>}
            {materials.length === 0 && !materialsMessage && <p className="classroom-materials-empty">No course materials found yet.</p>}
            {materials.length > 0 && <ul className="classroom-materials-list">{materials.map((material) => {
              const imported = material.driveFileId && importedFiles.includes(material.driveFileId);
              const driveFileId = material.driveFileId;
              const fileStatus = driveFileId ? importFileStatuses[driveFileId] : undefined;
              return <li key={`${material.courseId}:${material.id}`} className="classroom-material-row">
                <div className="classroom-material-copy"><span className="classroom-material-kind">{material.kind}</span><strong>{material.title}</strong><span>{material.courseName} · {material.parentTitle}</span></div>
                <div className="classroom-material-actions">
                  {material.url && <a href={material.url} target="_blank" rel="noreferrer" className="course-action-link">Open in Google ↗</a>}
                  {driveFileId && <button type="button" className="grok-sync-btn" disabled={Boolean(importingFile) || Boolean(imported && fileStatus !== "failed")} onClick={() => void importClassroomFile(driveFileId)}>{importingFile === driveFileId ? "Importing…" : fileStatus === "failed" ? "Retry processing" : fileStatus === "uploaded" || fileStatus === "processing" ? "Preparing…" : imported ? "Imported" : "Import to VidyaSarthi"}</button>}
                </div>
              </li>;
            })}</ul>}
          </div>
        </section>
      )}
    </div>
  );
}

type SpeechRecognitionInstance = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
