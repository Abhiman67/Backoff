ALTER TABLE "Profile"
ADD COLUMN "notificationPreferences" JSONB NOT NULL
DEFAULT '{"classroom":true,"routines":true,"approvals":true}'::jsonb;
