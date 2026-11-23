import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchClassroomMaterials } from "./classroom";

afterEach(() => vi.unstubAllGlobals());

describe("Classroom material access", () => {
  it("keeps assignment attachments when standalone materials are forbidden", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: URL) => {
      const path = new URL(input).pathname;
      if (path === "/v1/courses") return Response.json({ courses: [{ id: "course-1", name: "Data Mining" }] });
      if (path.endsWith("/courseWork")) return Response.json({ courseWork: [{
        id: "work-1", title: "Assignment 1", materials: [{ driveFile: { driveFile: { id: "file-1", title: "Lecture.pdf" } } }],
      }] });
      if (path.endsWith("/courseWorkMaterials")) return Response.json({ error: { status: "PERMISSION_DENIED" } }, { status: 403 });
      throw new Error(`Unexpected request: ${path}`);
    }));

    const result = await fetchClassroomMaterials("test-token");
    expect(result.restrictedCourseCount).toBe(1);
    expect(result.materials).toMatchObject([{ courseId: "course-1", driveFileId: "file-1", title: "Lecture.pdf" }]);
  });
});
