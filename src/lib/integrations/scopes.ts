export const CLASSROOM_MATERIALS_SCOPE = "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly";

export const MIN_SCOPES: Record<string, string[]> = {
  drive: ["https://www.googleapis.com/auth/drive.readonly"],
  classroom: [
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
    CLASSROOM_MATERIALS_SCOPE,
  ],
  calendar: ["https://www.googleapis.com/auth/calendar.events.readonly"],
  github: ["repo:read"],
  notion: ["read"],
  gmail: ["gmail.compose"],
};
