# Routes

Next.js maps route files under `src/app` to pages and API endpoints. This document groups the main routes; the source tree is the complete, current list.

To list every page and API handler, run:

```bash
rg --files src/app | rg '/(page|route)\.tsx?$'
```

## Public pages

- `/`, `/agents`, `/how-it-works`, `/pricing`, `/prototype`
- `/login`, `/signup`, `/forgot-password`, `/invite/accept`
- `/privacy`, `/terms`, `/security`, `/accessibility`, `/status`

## Student workspace

- `/app` and `/app/today`
- `/app/agents` and `/app/agents/[agentId]`
- `/app/projects`, `/app/projects/new`, and `/app/projects/[projectId]`
- `/app/tasks`, `/app/progress`, `/app/learning`, and `/app/learning/[subjectId]`
- `/app/files`, `/app/knowledge`, `/app/knowledge/graph`, `/app/knowledge/folders`, `/app/knowledge/templates`, and `/app/knowledge/[noteId]/history`
- `/app/career` and `/app/career/[goalId]`
- `/app/approvals`, `/app/notifications`, `/app/responsibilities`, and `/app/usage`
- `/app/settings` with profile, memory, privacy, integrations, and audit pages

## API groups

The API routes live under `src/app/api`. Main groups include authentication, profile, agents and runs, approvals, tasks, projects, career, files, notes, learning subjects, notifications, responsibilities, integrations, workspaces, usage, privacy export, metrics, and health.

Google integration routes include:

- `/api/integrations/classroom/connect`, `/callback`, `/courses`, `/sync`, `/materials`, and `/import`
- `/api/integrations/drive/connect`, `/callback`, `/files`, and `/import`
- `/api/integrations/calendar/connect`, `/callback`, and `/events`

For exact methods, request schemas, authentication, and behavior, read each route handler in `src/app/api`.
