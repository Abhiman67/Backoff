# VidyaSarthi

VidyaSarthi is a student workspace for coursework, notes, projects, and career preparation. Students can use focused AI agents, organize knowledge as linked Markdown notes, and turn plans into tasks. Google Classroom sync brings in courses and assignments. Students approve actions before anything is sent externally.

Created and maintained by **Abhishek** ([Abhiman67](https://github.com/Abhiman67)).

## Product scope

The current codebase includes:

- A student workspace with agents, tasks, projects, career goals, routines, approvals, and progress views.
- A knowledge workspace with Markdown notes, folders, tags, wikilinks, backlinks, a graph, templates, revision history, and JSON import and export.
- Study actions for explaining, summarizing, quizzing, flashcards, and study plans. File study actions use the selected file as context.
- Google Classroom course and assignment sync, published course materials, and task reminders. Drive attachments can be imported separately when Google Drive is connected.
- Assignment workspaces link each task to notes and files, a next action, source-backed practice, concept mastery, and follow-up revision. Classroom coursework opens the same workspace.
- Read-only Google Calendar event sync and read-only Drive access. GitHub, Notion, and Gmail actions are previews and do not call those providers.
- Approval records for supported external actions, ownership checks on API routes, audit events, and encrypted integration tokens.

## Current limits

This is an active project, not a fully operated SaaS. Before a public launch, configure and verify production OAuth, database migrations, AI credentials, scheduled jobs, email delivery, backups, and monitoring.

- Billing is a stub. The app does not charge users.
- Production uploads require S3-compatible storage. Configure the bucket, endpoint, region, and credentials, then verify a put/get/delete round trip against the target provider before accepting live student files. Existing local uploads are not migrated automatically.
- The default job mode runs jobs inline. Redis workers need a configured Redis service and a running worker process.
- Uploaded file chunks use OpenAI `text-embedding-3-small` when `OPENAI_API_KEY` is configured. Without it, search uses source text matching. Existing files need reindexing to gain embeddings; notes remain searchable from their Markdown text. The app stores vectors in JSON and scores them in the app, so scale testing is still needed for large libraries.
- Assignment practice uses an AI provider when configured and falls back to extractive active recall from the selected excerpt. Results are student self-checks against visible answer keys; they are not automatically graded.
- Google OAuth is a separate Cloud Console setup. Classroom material access needs the `classroom.courseworkmaterials.readonly` scope. Importing attachment contents also needs the separate Drive connection.
- Some college domains deny the standalone Classroom materials endpoint even when assignment attachments are readable. The materials view keeps accessible assignment attachments and reports restricted courses. A live attachment import still requires a separate Drive connection.
- Email sends password-reset and workspace-invitation messages only when `RESEND_API_KEY` and `EMAIL_FROM` are configured.

## Run locally

You need Node.js 20 or newer and Bun or npm. SQLite is the default local database.

```bash
cp .env.example .env
bun install
bunx prisma migrate dev
bun run db:seed
bun run dev
```

Open <http://localhost:3000>. Set `AUTH_SECRET` in `.env` before signing in. `ALLOW_MOCK_AI="true"` allows local use without an AI provider. Set it to `false` after you configure a supported provider.

## Google integrations

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then enable the Classroom API, Drive API, and Calendar API in the same Google Cloud project. Add the callback URLs from `.env.example` to the OAuth client. Add the Classroom material read-only scope to the OAuth consent configuration:

```text
https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly
```

Reconnect Classroom after adding the scope. Connect Drive separately if students need to import attachment contents. Google may limit OAuth access to listed test users while the consent screen remains in testing.

## PostgreSQL and Vercel

The repository keeps separate migration histories for SQLite and PostgreSQL. For a new empty PostgreSQL database, set `DATABASE_URL` and run:

```bash
npm run db:pg-bootstrap
```

For an existing database that was initialized from the PostgreSQL baseline, verify its schema first, mark `20261118000000_baseline` as applied, and deploy later migrations with `npm run db:pg-deploy`. Do not mark the baseline as applied on an empty database.

Vercel uses `npm run build:vercel` through `vercel.json`. Set `DATABASE_URL`, `AUTH_SECRET`, `NEXTAUTH_URL`, OAuth credentials, `CRON_SECRET`, and S3 credentials in the Vercel project. The scheduled route runs the daily responsibility tick, including Classroom sync. Check the Classroom connection status for its last successful sync. Redis jobs need a separately running worker.

## Useful commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start the development server |
| `bun run build` | Generate the local Prisma client and build the app |
| `bun run build:vercel` | Sync the PostgreSQL schema and build for Vercel |
| `bun run typecheck` | Check TypeScript types |
| `bun run test` | Run the Vitest suite |
| `bun run test:integration` | Run the integration suite |
| `bun run lint` | Run ESLint |
| `bun run worker` | Start the background worker |
| `npm run db:pg-deploy` | Apply PostgreSQL migrations |

## Repository map

| Path | Contents |
| --- | --- |
| `src/app` | Public pages, student workspace, and API routes |
| `src/components` | Shared UI and workspace components |
| `src/lib/agents` | Agent planner, run orchestration, and state transitions |
| `src/lib/integrations` | Google OAuth, Classroom, Drive, Calendar, and provider adapters |
| `src/lib/jobs` | Inline and Redis job queues and processors |
| `src/lib/storage` | File storage interface and current local storage driver |
| `prisma/schema.prisma` | SQLite schema |
| `prisma/migrations` | SQLite migration history |
| `prisma/postgres` | PostgreSQL schema and migration history |

## Documentation

See [`docs/README.md`](docs/README.md) for active guides and archived plans. `design.md` records product and visual intent. The code and this README describe the current implementation.

## License

Copyright © 2026 Abhishek. This project uses the ISC License. See `package.json`.
