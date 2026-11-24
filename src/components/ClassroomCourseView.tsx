"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

type ImportedFile = { driveFileId: string | null; status: string };
const courseItemSchema = z.object({
  id: z.string(), title: z.string(), type: z.enum(["assignment", "quiz", "project", "reading", "material"]),
  dueText: z.string().optional(), dueDate: z.string().optional(), status: z.enum(["pending", "completed", "due_soon", "overdue"]),
  link: z.string().optional(), driveAttachments: z.array(z.object({ driveFileId: z.string(), title: z.string() })).optional(),
});
const courseSchema = z.object({
  id: z.string(), name: z.string(), section: z.string().optional(), classroomUrl: z.string().optional(), instructor: z.string(), room: z.string().optional(),
  colorScheme: z.enum(["purple", "blue", "teal", "orange"]), assignments: z.array(courseItemSchema),
});
const materialSchema = z.object({
  id: z.string(), courseId: z.string(), courseName: z.string(), parentTitle: z.string(), title: z.string(),
  kind: z.enum(["drive", "link", "youtube", "form"]), url: z.string().nullable(), driveFileId: z.string().nullable(),
});
const coursePayloadSchema = z.object({ courses: z.array(courseSchema).optional(), error: z.object({ message: z.string().optional() }).optional() });
const materialsPayloadSchema = z.object({
  materials: z.array(materialSchema).optional(),
  importedFiles: z.array(z.object({ driveFileId: z.string().nullable(), status: z.string() })).optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});
const importPayloadSchema = z.object({ file: z.object({ status: z.string() }).optional(), error: z.object({ message: z.string().optional() }).optional() });
type ClassroomCourse = z.infer<typeof courseSchema>;
type ClassroomMaterial = z.infer<typeof materialSchema>;

function fileActionLabel(status: string | undefined) {
  if (status === "ready") return "Ready in Files";
  if (status === "failed") return "Retry import";
  if (status === "uploaded" || status === "processing" || status === "queued") return "Preparing…";
  return "Import to VidyaSarthi";
}

export function ClassroomCourseView({ courseId }: { courseId: string }) {
  const [course, setCourse] = useState<ClassroomCourse | null>(null);
  const [materials, setMaterials] = useState<ClassroomMaterial[]>([]);
  const [fileStatuses, setFileStatuses] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyFileId, setBusyFileId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadCourse = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [coursesResponse, materialsResponse] = await Promise.all([
        fetch("/api/integrations/classroom/courses", { cache: "no-store" }),
        fetch("/api/integrations/classroom/materials", { cache: "no-store" }),
      ]);
      const [coursesRaw, materialsRaw] = await Promise.all([coursesResponse.json(), materialsResponse.json()]);
      const coursesParsed = coursePayloadSchema.safeParse(coursesRaw);
      const materialsParsed = materialsPayloadSchema.safeParse(materialsRaw);
      if (!coursesParsed.success || !materialsParsed.success) throw new Error("The Classroom response could not be read. Refresh and try again.");
      const coursesData = coursesParsed.data;
      const materialsData = materialsParsed.data;
      if (!coursesResponse.ok) throw new Error(coursesData.error?.message ?? "Could not load your Classroom courses.");
      if (!materialsResponse.ok) throw new Error(materialsData.error?.message ?? "Could not load this course’s shared materials.");

      setCourse((coursesData.courses ?? []).find((item) => item.id === courseId) ?? null);
      setMaterials((materialsData.materials ?? []).filter((item) => item.courseId === courseId));
      setFileStatuses(Object.fromEntries((materialsData.importedFiles ?? []).flatMap(({ driveFileId, status }) => driveFileId ? [[driveFileId, status]] : [])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load this course.");
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => { void loadCourse(); }, [loadCourse]);

  async function importFile(driveFileId: string) {
    if (busyFileId) return;
    setBusyFileId(driveFileId);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/integrations/classroom/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driveFileId }),
      });
      const rawPayload = await response.json();
      const payload = importPayloadSchema.safeParse(rawPayload);
      if (!payload.success) throw new Error("The import response could not be read. Check Files & notes for its status.");
      if (!response.ok) throw new Error(payload.data.error?.message ?? "Could not import this course file.");
      const status = payload.data.file?.status ?? "processing";
      setFileStatuses((current) => ({ ...current, [driveFileId]: status }));
      setNotice(status === "ready" ? "File is ready in Files & notes." : "File imported. VidyaSarthi is preparing it for your notes and agents.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import this course file.");
    } finally {
      setBusyFileId("");
    }
  }

  if (loading) return <main className="classroom-course-page"><p>Loading course and shared materials…</p></main>;
  if (error && !course) return <main className="classroom-course-page"><Link className="classroom-course-back" href="/app">← Overview</Link><p className="classroom-course-error" role="alert">{error}</p><button className="button secondary" type="button" onClick={() => void loadCourse()}>Try again</button></main>;
  if (!course) return <main className="classroom-course-page"><Link className="classroom-course-back" href="/app">← Overview</Link><section className="panel classroom-course-empty"><h1>Course not found</h1><p>This course may have been archived or removed from your active Classroom courses.</p><Link className="button secondary" href="/app">Back to overview</Link></section></main>;

  const driveFiles = materials.filter((item) => item.kind === "drive" && item.driveFileId);
  const linkedMaterials = materials.filter((item) => item.kind !== "drive" || !item.driveFileId);
  const openAssignments = course.assignments.filter((item) => item.status !== "completed").length;

  return <main className="classroom-course-page">
    <Link className="classroom-course-back" href="/app">← Overview</Link>
    <header className={`classroom-course-hero color-${course.colorScheme}`}>
      <div>
        <span className="course-section-badge">{course.section}</span>
        <h1>{course.name}</h1>
        <p>{course.instructor}{course.room ? ` · ${course.room}` : ""}</p>
      </div>
      {course.classroomUrl && <a className="button secondary" href={course.classroomUrl} target="_blank" rel="noreferrer">Open Classroom ↗</a>}
      <div className="classroom-course-stats" aria-label="Course overview">
        <span><strong>{course.assignments.length}</strong> assignments</span>
        <span><strong>{openAssignments}</strong> to do</span>
        <span><strong>{materials.length}</strong> shared materials</span>
      </div>
    </header>

    {(error || notice) && <p className={error ? "classroom-course-error" : "classroom-course-notice"} role={error ? "alert" : "status"}>{error || notice}</p>}

    <section className="panel classroom-course-section">
      <div className="classroom-course-section-heading"><div><h2>Assignments & coursework</h2><p>Deadlines and work shared in this Classroom course.</p></div><Link className="course-action-link" href="/app/tasks">Open planner →</Link></div>
      {course.assignments.length === 0 ? <div className="classroom-course-empty-state"><strong>No published assignments yet</strong><span>New coursework from this course will appear here after a sync.</span></div> : <ul className="classroom-course-assignment-list">
        {course.assignments.map((item) => <li key={item.id}>
          <span className={`course-status-bullet bullet-${item.status}`} aria-hidden="true" />
          <div className="classroom-course-assignment-copy"><strong>{item.title}</strong><span>{item.type.replaceAll("_", " ")}{item.dueText ? ` · ${item.dueText}` : ""}</span></div>
          <span className={`course-due-tag tag-${item.status}`}>{item.status.replaceAll("_", " ")}</span>
          {item.link && <a className="button secondary" href={item.link} target="_blank" rel="noreferrer">Open in Classroom ↗</a>}
        </li>)}
      </ul>}
    </section>

    <section className="panel classroom-course-section">
      <div className="classroom-course-section-heading"><div><h2>Files shared by your teacher</h2><p>Drive attachments and other materials posted to this course’s assignments or stream.</p></div><button className="button secondary" type="button" onClick={() => void loadCourse()}>Refresh</button></div>
      {materials.length === 0 ? <div className="classroom-course-empty-state"><strong>No shared materials found</strong><span>Classroom only exposes files and links attached to published assignments or course materials.</span></div> : <ul className="classroom-course-material-list">
        {materials.map((material) => {
          const fileStatus = material.driveFileId ? fileStatuses[material.driveFileId] : undefined;
          const isImported = fileStatus && fileStatus !== "failed";
          return <li key={`${material.courseId}:${material.id}`}>
            <span className="classroom-course-material-kind">{material.kind === "drive" ? "DRIVE FILE" : material.kind.toUpperCase()}</span>
            <div className="classroom-course-material-copy"><strong>{material.title}</strong><span>Shared with: {material.parentTitle}</span></div>
            <div className="classroom-course-material-actions">
              {material.url && <a className="course-action-link" href={material.url} target="_blank" rel="noreferrer">Open in Google ↗</a>}
              {material.driveFileId && (() => {
                const driveFileId = material.driveFileId;
                return <button className="button secondary" type="button" disabled={Boolean(busyFileId) || Boolean(isImported)} onClick={() => void importFile(driveFileId)}>{busyFileId === driveFileId ? "Importing…" : fileActionLabel(fileStatus)}</button>;
              })()}
            </div>
          </li>;
        })}
      </ul>}
      {driveFiles.length > 0 && <p className="classroom-course-footnote">Imported files are processed for search and study tools in <Link href="/app/files">Files & notes</Link>.</p>}
      {linkedMaterials.length > 0 && <p className="classroom-course-footnote">Links, videos, and forms open in their original Google or web location.</p>}
    </section>
  </main>;
}
