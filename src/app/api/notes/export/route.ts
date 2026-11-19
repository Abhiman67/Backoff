import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleApi, HttpError } from "@/lib/api";

export const GET = handleApi(async (_request, { userId }) => {
  const where = { ownerId: userId, mimeType: "text/markdown", status: { not: "deleted" } };
  const total = await db.file.count({ where });
  if (total > 500) {
    throw new HttpError("EXPORT_TOO_LARGE", 413, "This backup has more than 500 notes. Export individual notes from the editor.", false);
  }
  const notes = await db.file.findMany({
    where,
    select: { name: true, textContent: true, folder: true, tags: true, subjectId: true, projectId: true, careerGoalId: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 500,
  });
  const contentBytes = notes.reduce((total, note) => total + Buffer.byteLength(note.textContent), 0);
  if (contentBytes > 8 * 1024 * 1024) {
    throw new HttpError("EXPORT_TOO_LARGE", 413, "This notes backup is over 8 MB. Export individual notes from the editor.", false);
  }
  const payload = {
    format: "backoff-notes-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    notes: notes.map((note) => ({
      title: note.name.replace(/\.md$/i, ""),
      content: note.textContent,
      folder: note.folder,
      tags: note.tags,
      subjectId: note.subjectId,
      projectId: note.projectId,
      careerGoalId: note.careerGoalId,
      createdAt: note.createdAt.toISOString(),
    })),
  };
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": "attachment; filename=vidyasarthi-notes-export.json",
    },
  });
}, { rateLimit: { keyPrefix: "notes-export", limit: 10, windowSec: 3600 } });
