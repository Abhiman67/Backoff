ALTER TABLE "Profile" ADD COLUMN "notificationPreferences" JSON NOT NULL DEFAULT '{"classroom":true,"routines":true,"approvals":true}';
