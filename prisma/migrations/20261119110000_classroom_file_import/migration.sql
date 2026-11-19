ALTER TABLE "File" ADD COLUMN "sourceProvider" TEXT;
ALTER TABLE "File" ADD COLUMN "sourceExternalId" TEXT;
CREATE UNIQUE INDEX "File_ownerId_sourceProvider_sourceExternalId_key" ON "File"("ownerId", "sourceProvider", "sourceExternalId");
