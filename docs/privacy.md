# Data handling in the current codebase

This page records behavior implemented in the repository. It is not a retention guarantee or a substitute for the public privacy policy. Check the relevant route and storage driver before making user-facing claims.

## Data the app stores

The database stores account and profile data, workspace content, notes, files and extracted text, agent conversations and runs, approvals, audit events, integration metadata, notification preferences, and usage records. Google access and refresh tokens are encrypted before the app stores them.

Configured AI providers receive the prompts and selected context sent by the app. The app does not control a provider's retention or training settings. Review the provider configuration and terms before production use.

## File deletion

Deleting a file removes its stored bytes through the configured storage driver, removes its chunks, clears extracted text, and marks the database row as `deleted`. The repository has no scheduled hard-delete job for file metadata.

The current S3-compatible storage code only writes remote objects. Its read and delete methods use local storage. Do not configure it for production file storage until the driver supports and verifies all three operations.

## Account deletion

The account deletion route attempts to delete each file object through the configured storage driver, then deletes the user row. Database relations cascade according to `prisma/schema.prisma`. Audit events use `onDelete: SetNull`, so their records can remain without an owner ID. The repository does not define an audit-event retention schedule.

## Integration disconnect

Disconnecting an integration removes VidyaSarthi's saved token record. The current disconnect route does not call Google's token revocation endpoint.

## Backups and external services

The repository does not configure a production backup schedule or a backup retention period. Set those policies with the database and storage providers, then run restore drills. See [`backups.md`](backups.md).

Email sends require `RESEND_API_KEY` and `EMAIL_FROM`. The current code sends password-reset and workspace-invitation emails. Google Classroom, Drive, and Calendar use OAuth scopes documented in the root README.
