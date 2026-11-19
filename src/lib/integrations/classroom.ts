import { MIN_SCOPES } from "./scopes";
import { z } from "zod";

const courseSchema = z.object({ id: z.string(), name: z.string(), section: z.string().optional() });
const courseworkSchema = z.object({
  id: z.string(),
  title: z.string(),
  workType: z.string().optional(),
  dueDate: z.object({ year: z.number().int(), month: z.number().int(), day: z.number().int() }).optional(),
  dueTime: z.object({ hours: z.number().optional(), minutes: z.number().optional() }).optional(),
  alternateLink: z.string().optional(),
  state: z.string().optional(),
  materials: z.array(z.unknown()).optional(),
});
const materialWorkSchema = z.object({
  id: z.string(),
  title: z.string(),
  materials: z.array(z.unknown()).optional(),
  alternateLink: z.string().optional(),
});
const MAX_CLASSROOM_PAGES = 20;

export type ClassroomOperation = "courses" | "coursework" | "submissions" | "materials";

export type ClassroomMaterial = {
  id: string;
  courseId: string;
  courseName: string;
  parentTitle: string;
  title: string;
  kind: "drive" | "link" | "youtube" | "form";
  url: string | null;
  driveFileId: string | null;
};

function safeGoogleUrl(value: string | undefined): string | null {
  if (!value) return null;
  try { return new URL(value).protocol === "https:" ? value : null; }
  catch { return null; }
}

export class ClassroomApiError extends Error {
  constructor(
    readonly operation: ClassroomOperation,
    readonly httpStatus: number | null,
    readonly googleStatus?: string,
    readonly reason?: string
  ) {
    super(httpStatus === null ? "Google Classroom network request failed." : `Google Classroom request failed (${httpStatus}).`);
    this.name = "ClassroomApiError";
  }
}

const googleErrorSchema = z.object({
  error: z.object({
    status: z.string().optional(),
    errors: z.array(z.object({ reason: z.string().optional() })).optional(),
  }).optional(),
}).passthrough();

async function fetchPage(url: URL, accessToken: string, operation: ClassroomOperation) {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new ClassroomApiError(operation, null, "NETWORK_ERROR");
  }
  if (!response.ok) {
    let googleStatus: string | undefined;
    let reason: string | undefined;
    try {
      const parsed = googleErrorSchema.safeParse(await response.json());
      if (parsed.success) {
        googleStatus = parsed.data.error?.status;
        reason = parsed.data.error?.errors?.find((entry) => entry.reason)?.reason;
      }
    } catch {
      // Keep the HTTP status even when Google returns a non-JSON error body.
    }
    throw new ClassroomApiError(operation, response.status, googleStatus, reason);
  }
  return response.json();
}

async function fetchAllCourses(accessToken: string) {
  const courses: z.infer<typeof courseSchema>[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_CLASSROOM_PAGES; page += 1) {
    const url = new URL("https://classroom.googleapis.com/v1/courses");
    url.searchParams.set("courseStates", "ACTIVE");
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const data = z.object({ courses: z.array(courseSchema).optional(), nextPageToken: z.string().optional() }).parse(await fetchPage(url, accessToken, "courses"));
    courses.push(...(data.courses ?? []));
    if (!data.nextPageToken) return courses;
    pageToken = data.nextPageToken;
  }
  throw new Error("Google Classroom has more course pages than this sync can safely load.");
}

async function fetchCourseWork(accessToken: string, courseId: string) {
  const work: z.infer<typeof courseworkSchema>[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_CLASSROOM_PAGES; page += 1) {
    const url = new URL(`https://classroom.googleapis.com/v1/courses/${encodeURIComponent(courseId)}/courseWork`);
    url.searchParams.set("courseWorkStates", "PUBLISHED");
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const data = z.object({ courseWork: z.array(courseworkSchema).optional(), nextPageToken: z.string().optional() }).parse(await fetchPage(url, accessToken, "coursework"));
    work.push(...(data.courseWork ?? []));
    if (!data.nextPageToken) return work;
    pageToken = data.nextPageToken;
  }
  throw new Error(`Google Classroom returned too many coursework pages for course ${courseId}.`);
}

function normalizeMaterial(raw: unknown, context: Omit<ClassroomMaterial, "id" | "title" | "kind" | "url" | "driveFileId"> & { parentId: string }, index: number): ClassroomMaterial | null {
  const { parentId, ...visibleContext } = context;
  const parsed = z.object({
    driveFile: z.object({ driveFile: z.object({ id: z.string().optional(), title: z.string().optional(), alternateLink: z.string().url().optional() }).optional() }).optional(),
    link: z.object({ url: z.string().url().optional(), title: z.string().optional() }).optional(),
    youtubeVideo: z.object({ id: z.string().optional(), title: z.string().optional(), alternateLink: z.string().url().optional() }).optional(),
    form: z.object({ formUrl: z.string().url().optional(), title: z.string().optional() }).optional(),
  }).safeParse(raw);
  if (!parsed.success) return null;
  const value = parsed.data;
  if (value.driveFile) {
    const file = value.driveFile.driveFile;
    if (!file) return null;
    return { ...visibleContext, id: file.id ?? `${parentId}:drive:${index}`, title: file.title ?? "Classroom file", kind: "drive", url: safeGoogleUrl(file.alternateLink), driveFileId: file.id ?? null };
  }
  if (value.link) return { ...visibleContext, id: `${parentId}:link:${index}`, title: value.link.title ?? value.link.url ?? "Link", kind: "link", url: safeGoogleUrl(value.link.url), driveFileId: null };
  if (value.youtubeVideo) return { ...visibleContext, id: `${parentId}:youtube:${index}`, title: value.youtubeVideo.title ?? "YouTube video", kind: "youtube", url: safeGoogleUrl(value.youtubeVideo.alternateLink) ?? (value.youtubeVideo.id ? `https://www.youtube.com/watch?v=${encodeURIComponent(value.youtubeVideo.id)}` : null), driveFileId: null };
  if (value.form) return { ...visibleContext, id: `${parentId}:form:${index}`, title: value.form.title ?? "Google Form", kind: "form", url: safeGoogleUrl(value.form.formUrl), driveFileId: null };
  return null;
}

async function fetchCourseWorkMaterials(accessToken: string, courseId: string) {
  const items: z.infer<typeof materialWorkSchema>[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_CLASSROOM_PAGES; page += 1) {
    const url = new URL(`https://classroom.googleapis.com/v1/courses/${encodeURIComponent(courseId)}/courseWorkMaterials`);
    url.searchParams.set("courseWorkMaterialStates", "PUBLISHED");
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const data = z.object({ courseWorkMaterial: z.array(materialWorkSchema).optional(), nextPageToken: z.string().optional() }).parse(await fetchPage(url, accessToken, "materials"));
    items.push(...(data.courseWorkMaterial ?? []));
    if (!data.nextPageToken) return items;
    pageToken = data.nextPageToken;
  }
  throw new Error(`Google Classroom returned too many material pages for course ${courseId}.`);
}

export async function listClassroomMaterials(accessToken: string): Promise<ClassroomMaterial[]> {
  if (!accessToken || isMockToken(accessToken)) return [];
  const courses = await fetchAllCourses(accessToken);
  const out: ClassroomMaterial[] = [];
  for (const course of courses) {
    const [work, materials] = await Promise.all([fetchCourseWork(accessToken, course.id), fetchCourseWorkMaterials(accessToken, course.id)]);
    for (const item of work) {
      for (const [index, raw] of (item.materials ?? []).entries()) {
        const normalized = normalizeMaterial(raw, { courseId: course.id, courseName: course.name, parentTitle: item.title, parentId: item.id }, index);
        if (normalized) out.push(normalized);
      }
    }
    for (const item of materials) {
      for (const [index, raw] of (item.materials ?? []).entries()) {
        const normalized = normalizeMaterial(raw, { courseId: course.id, courseName: course.name, parentTitle: item.title, parentId: item.id }, index);
        if (normalized) out.push(normalized);
      }
    }
  }
  const seen = new Set<string>();
  return out.filter((item) => {
    const key = item.driveFileId ? `drive:${item.driveFileId}` : `${item.kind}:${item.url ?? item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchSubmissionStates(accessToken: string, courseId: string) {
  const states = new Map<string, string>();
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_CLASSROOM_PAGES; page += 1) {
    const url = new URL(`https://classroom.googleapis.com/v1/courses/${encodeURIComponent(courseId)}/courseWork/-/studentSubmissions`);
    url.searchParams.set("userId", "me");
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const data = z.object({
      studentSubmissions: z.array(z.object({ courseWorkId: z.string().optional(), state: z.string().optional() })).optional(),
      nextPageToken: z.string().optional(),
    }).parse(await fetchPage(url, accessToken, "submissions"));
    for (const submission of data.studentSubmissions ?? []) {
      if (submission.courseWorkId && submission.state) states.set(submission.courseWorkId, submission.state);
    }
    if (!data.nextPageToken) return states;
    pageToken = data.nextPageToken;
  }
  throw new Error(`Google Classroom returned too many submission pages for course ${courseId}.`);
}

export type ClassroomCourse = {
  id: string;
  name: string;
  section?: string;
  descriptionHeading?: string;
  instructor: string;
  room?: string;
  colorScheme: "purple" | "blue" | "teal" | "orange";
  assignments: ClassroomItem[];
};

export type ClassroomItem = {
  id: string;
  title: string;
  type: "assignment" | "quiz" | "project" | "reading" | "material";
  dueText?: string;
  dueDate?: string;
  status: "pending" | "completed" | "due_soon" | "overdue";
  link?: string;
};

export function mockClassroomCourses(): ClassroomCourse[] {
  return [
    {
      id: "course-cs301",
      name: "Data Structures & Algorithms",
      section: "CS-301",
      instructor: "Prof. Mehta",
      colorScheme: "purple",
      assignments: [
        {
          id: "cs301-a4",
          title: "Assignment 4",
          type: "assignment",
          dueText: "Due Tomorrow",
          status: "due_soon",
        },
        {
          id: "cs301-q2",
          title: "Quiz 2",
          type: "quiz",
          dueText: "Due Sep 12",
          status: "pending",
        },
      ],
    },
    {
      id: "course-cs302",
      name: "Operating Systems",
      section: "CS-302",
      instructor: "Prof. Rao",
      colorScheme: "blue",
      assignments: [
        {
          id: "cs302-proj",
          title: "Project Proposal",
          type: "project",
          dueText: "Due Sep 15",
          status: "pending",
        },
        {
          id: "cs302-read",
          title: "Reading: Chapter 3",
          type: "reading",
          dueText: "No due date",
          status: "pending",
        },
      ],
    },
    {
      id: "course-cs303",
      name: "Database Management",
      section: "CS-303",
      instructor: "Prof. Sharma",
      colorScheme: "teal",
      assignments: [
        {
          id: "cs303-a2",
          title: "Assignment 2",
          type: "assignment",
          dueText: "Due Friday",
          status: "due_soon",
        },
        {
          id: "cs303-rev",
          title: "Midterm Revision",
          type: "reading",
          dueText: "Due Sep 18",
          status: "pending",
        },
      ],
    },
    {
      id: "course-cs304",
      name: "Artificial Intelligence",
      section: "CS-304",
      instructor: "Prof. Khan",
      colorScheme: "orange",
      assignments: [
        {
          id: "cs304-a1",
          title: "Assignment 1",
          type: "assignment",
          dueText: "Completed",
          status: "completed",
        },
        {
          id: "cs304-mat",
          title: "New Material",
          type: "material",
          dueText: "Added yesterday",
          status: "pending",
        },
      ],
    },
  ];
}

export function getClassroomUpcomingList(courses: ClassroomCourse[]) {
  const all: { courseName: string; courseSection?: string; item: ClassroomItem }[] = [];
  for (const c of courses) {
    for (const a of c.assignments) {
      all.push({
        courseName: c.name,
        courseSection: c.section,
        item: a,
      });
    }
  }
  return all;
}

export function isMockToken(token: string): boolean {
  return token.startsWith("mock_");
}

export async function listClassroomCourses(accessToken: string): Promise<ClassroomCourse[]> {
  if (!accessToken || isMockToken(accessToken)) {
    return mockClassroomCourses();
  }

  try {
    const allCourses = await fetchAllCourses(accessToken);
    const colors: ("purple" | "blue" | "teal" | "orange")[] = ["purple", "blue", "teal", "orange"];
    const courses: ClassroomCourse[] = [];
    for (let offset = 0; offset < allCourses.length; offset += 5) {
      const batch = await Promise.all(allCourses.slice(offset, offset + 5).map(async (c, index) => {
        const idx = offset + index;
        const workItems = await fetchCourseWork(accessToken, c.id);
        const submissionStates = workItems.length > 0 ? await fetchSubmissionStates(accessToken, c.id) : new Map<string, string>();
        const assignments = workItems.map((w) => {
          const submissionState = submissionStates.get(w.id);
          const dueDate = w.dueDate ? new Date(Date.UTC(w.dueDate.year, w.dueDate.month - 1, w.dueDate.day, w.dueTime?.hours ?? 23, w.dueTime?.minutes ?? 59)) : undefined;
          const submitted = submissionState === "TURNED_IN" || submissionState === "RETURNED";
          const status = submitted || w.state === "DELETED" ? "completed" : dueDate && dueDate.getTime() < Date.now() ? "overdue" : dueDate && dueDate.getTime() < Date.now() + 3 * 86400000 ? "due_soon" : "pending";
          const type: ClassroomItem["type"] = w.workType === "QUIZ" ? "quiz" : w.workType === "PROJECT" ? "project" : "assignment";
          return { id: w.id, title: w.title, type, dueDate: dueDate?.toISOString(), dueText: dueDate ? `Due ${dueDate.toLocaleDateString()}` : "No due date", status, link: w.alternateLink } satisfies ClassroomItem;
        });
        return { id: c.id, name: c.name, section: c.section ?? `SEC-${idx + 1}`, instructor: "Faculty Instructor", colorScheme: colors[idx % colors.length], assignments } satisfies ClassroomCourse;
      }));
      courses.push(...batch);
    }
    return courses;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Google Classroom could not be reached.");
  }
}

export function describeClassroomFailure(error: unknown) {
  if (!(error instanceof ClassroomApiError)) {
    return {
      message: "Google Classroom sync failed unexpectedly. Try reconnecting, then retry.",
      details: { operation: "unknown" },
    };
  }

  const details = {
    operation: error.operation,
    httpStatus: error.httpStatus,
    googleStatus: error.googleStatus,
    reason: error.reason,
  };

  if (error.httpStatus === null) {
    return { message: "Could not reach Google Classroom. Check your connection and retry.", details };
  }
  if (error.httpStatus === 401) {
    return { message: "Google Classroom authorization expired or was revoked. Reconnect Classroom and retry.", details };
  }
  if (error.reason === "accessNotConfigured") {
    return { message: "The Google Classroom API is not enabled for this OAuth project. Enable it in Google Cloud, then retry.", details };
  }
  if (error.httpStatus === 403) {
    return { message: "Google denied access to Classroom. Check that this Google account is a test user, has Classroom courses, and is allowed by its Workspace administrator.", details };
  }
  return { message: `Google Classroom returned an error (HTTP ${error.httpStatus}) while loading ${error.operation}. Retry or reconnect.`, details };
}
