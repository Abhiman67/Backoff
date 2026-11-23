ALTER TABLE "Task" ADD COLUMN "assignmentSourceIds" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Task" ADD COLUMN "nextAction" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Task" ADD COLUMN "practiceQuestions" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "FileChunk" ADD COLUMN "embedding" TEXT;
ALTER TABLE "Subject" ADD COLUMN "classroomCourseId" TEXT;
CREATE UNIQUE INDEX "Subject_ownerId_classroomCourseId_key" ON "Subject"("ownerId", "classroomCourseId");
ALTER TABLE "MasteryEvidence" ADD COLUMN "questionId" TEXT;
CREATE UNIQUE INDEX "MasteryEvidence_questionId_key" ON "MasteryEvidence"("questionId");
