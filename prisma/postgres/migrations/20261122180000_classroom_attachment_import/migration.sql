ALTER TABLE "IntegrationAccount" ADD COLUMN "autoImportAttachments" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ClassroomAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileId" TEXT,
    "lastError" TEXT,
    "attemptedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClassroomAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassroomAttachment_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ClassroomAttachment_taskId_driveFileId_key" ON "ClassroomAttachment"("taskId", "driveFileId");
CREATE INDEX "ClassroomAttachment_fileId_idx" ON "ClassroomAttachment"("fileId");
