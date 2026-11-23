ALTER TABLE "IntegrationAccount" ADD COLUMN "lastSyncedAt" TIMESTAMP(3);
ALTER TABLE "IntegrationAccount" ADD COLUMN "lastSyncError" TEXT;
