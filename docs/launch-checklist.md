# Production launch checklist

The codebase contains many core student flows, but a production launch still depends on provider setup and live verification. Complete this checklist in the deployment environment.

## Application and database

- [ ] Set `DATABASE_URL` to the production PostgreSQL database.
- [ ] Apply PostgreSQL migrations with `npm run db:pg-deploy` before deploying code that needs them.
- [ ] Set a unique `AUTH_SECRET` and the production `NEXTAUTH_URL`.
- [ ] Configure a supported AI provider and set `ALLOW_MOCK_AI="false"`.
- [ ] Configure error reporting and confirm that production errors reach the team.
- [ ] Configure backups, retention, access controls, and a restore drill.

## Google integrations

- [ ] Enable the Classroom, Drive, and Calendar APIs in Google Cloud.
- [ ] Configure the consent screen, test users or verification status, and production callback URLs.
- [ ] Add the Classroom courses, coursework, and coursework-materials read scopes.
- [ ] Connect Classroom and Drive separately, then verify course sync and one supported attachment import.
- [ ] Verify Calendar sync with an account that has events.

## Storage, jobs, and email

- [ ] Replace or complete the S3-compatible adapter. The current read and delete operations use local storage.
- [ ] Configure the job execution mode. If you use Redis mode, run Redis and a worker continuously.
- [ ] Set `CRON_SECRET` and verify the scheduled responsibility tick in Vercel logs.
- [ ] Configure Resend and a verified `EMAIL_FROM` domain if password-reset or invitation email is required.
- [ ] Confirm the hosting provider can keep database, object storage, and worker data available after redeploys.

## Product and operational checks

- [ ] Run the manual journey in [`e2e-qa.md`](e2e-qa.md) against staging.
- [ ] Check responsive layouts, keyboard navigation, and reduced-motion behavior on the shipped pages.
- [ ] Verify privacy and terms copy against deployed provider settings and actual retention policies.
- [ ] Replace the current public domain, support email, and Google OAuth app display name if the VidyaSarthi brand uses new values.
- [ ] Confirm billing is disabled or explicitly stubbed in public pricing and account flows.
- [ ] Record the release commit, environment, migration status, smoke-check results, and rollback owner.

## Known launch blockers in this repository

- The S3-compatible storage adapter lacks remote reads and deletes.
- Billing is a stub.
- Google OAuth requires deployment credentials, consent-screen setup, and a live authorization check.
- Redis workers, durable storage, backups, email, and monitoring need deployment setup and verification.
