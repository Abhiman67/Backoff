"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClassroomCourse, ClassroomMaterial } from "@/lib/integrations/classroom";

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
        const materialsResponse = await fetch("/api/integrations/classroom/materials", { cache: "no-store" });
        const materialsData = await materialsResponse.json();
        if (!materialsResponse.ok) {
          if (!cancelled) setMaterialsMessage(materialsData.error?.message ?? "Course materials could not be loaded.");
        } else if (!cancelled) {
          setMaterials(materialsData.materials ?? []);
          setImportedFiles(materialsData.importedDriveFileIds ?? []);
          setMaterialsMessage("");
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Courses could not be synced. Try reconnecting Classroom.");
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
      setImportedFiles((current) => current.includes(driveFileId) ? current : [...current, driveFileId]);
      setMaterialsMessage(data.alreadyImported ? "This file is already in Files & notes." : "File imported. VidyaSarthi is preparing it for your notes and agents.");
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
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Coursework could not be synced. Try again.");
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

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim()) return;
    // Hand the prompt to Study Coach via a real query param the chat reads.
    const flags = new URLSearchParams({ q: prompt.trim() }).toString();
    if (studyCoachId) {
      router.push(`/app/agents/${studyCoachId}?${flags}`);
    } else {
      router.push(`/app/agents?${flags}`);
    }
  };

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
                disabled={!prompt.trim()}
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
                onClick={() => router.push("/app/files")}
              >
                <span aria-hidden="true">+</span>
                <span>Attach notes</span>
              </button>
            </div>
            <span className="grok-disclaimer">
              Answers may be wrong. Verify against your course material.
            </span>
          </div>
        </form>
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
                  Connection active · <span className="tag" style={{ fontSize: 10 }}>{isSyncing ? "Syncing…" : isDemo ? "Preview courses" : "Live read-only sync"}</span>
                </p>
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
                    <h4 className="course-title">{course.name}</h4>
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
                } catch (cause) { setMaterialsMessage(cause instanceof Error ? cause.message : "Materials could not be refreshed."); }
              }}>Refresh materials</button>
            </div>
            {materialsMessage && <p role="status" aria-live="polite" className="classroom-materials-message">{materialsMessage}{(materialsMessage.includes("Reconnect Google Classroom") || materialsMessage.includes("Connect Google Drive") || materialsMessage.includes("Reconnect Drive")) && <> <Link href="/app/settings/integrations">Manage connections →</Link></>}</p>}
            {materials.length === 0 && !materialsMessage && <p className="classroom-materials-empty">No course materials found yet.</p>}
            {materials.length > 0 && <ul className="classroom-materials-list">{materials.map((material) => {
              const imported = material.driveFileId && importedFiles.includes(material.driveFileId);
              const driveFileId = material.driveFileId;
              return <li key={`${material.courseId}:${material.id}`} className="classroom-material-row">
                <div className="classroom-material-copy"><span className="classroom-material-kind">{material.kind}</span><strong>{material.title}</strong><span>{material.courseName} · {material.parentTitle}</span></div>
                <div className="classroom-material-actions">
                  {material.url && <a href={material.url} target="_blank" rel="noreferrer" className="course-action-link">Open in Google ↗</a>}
                  {driveFileId && <button type="button" className="grok-sync-btn" disabled={Boolean(importingFile) || Boolean(imported)} onClick={() => void importClassroomFile(driveFileId)}>{importingFile === driveFileId ? "Importing…" : imported ? "Imported" : "Import to VidyaSarthi"}</button>}
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
