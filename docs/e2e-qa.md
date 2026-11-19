# Manual release checks

No browser automation framework is configured in this repository. Use this checklist in a staging deployment before a release. Record the environment, commit, tester, and result for each section.

## Account and workspace

1. Create an account and complete onboarding.
2. Open the workspace overview and navigate to Today, Learning, Agents, Projects, Tasks, Knowledge, Files, Career, Approvals, and Settings.
3. Open a page while signed out. Confirm the app sends you to sign in.
4. Create a task, edit it, complete it, and confirm the change remains after refresh.

## Notes and files

1. Create a note, add a folder and tags, and link two notes with `[[wikilinks]]`.
2. Open backlinks and the note graph. Confirm both show the saved relationship.
3. Export the notes backup, then import it into a separate test account.
4. Upload a supported PDF, TXT, Markdown, or DOCX file. Confirm extraction completes and study actions use that file.
5. Delete the test file and confirm it disappears from the active file list.

## Agents and approvals

1. Ask an agent to create a plan from a course or project prompt.
2. Confirm the run shows its status and steps.
3. If the agent proposes an approval-gated action, review and deny it. Start another run and approve a safe action.
4. Refresh the page. Confirm run and approval states persist and no duplicate tasks appear.

## Google integrations

Run these checks only with a Google test account that has access to the configured APIs and Classroom courses.

1. Connect Google Classroom and confirm that courses and published assignments load.
2. Sync tasks. Confirm due dates and submitted state match Classroom.
3. Reconnect Classroom with the course-materials read-only scope. Confirm published links and attachments appear.
4. Open a material link. Connect Google Drive separately and import a supported attachment.
5. Confirm the imported file appears once in Files & notes, then retry the import and confirm it is not duplicated.
6. Connect Calendar and confirm read-only events appear in the student workspace.

## Release record

Record the date, environment, commit, tester, per-section result, failures, and follow-up issues. Do not mark a check complete based only on a successful build or API typecheck.
