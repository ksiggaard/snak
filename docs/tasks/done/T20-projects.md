# T20 — Projects (grouped threads with shared instructions + files)

- **Status:** done
- **Owner:** Wave1-T20
- **Priority:** P2
- **Layer:** DB (migration) + Rust + Frontend
- **Depends on:** —

Introduce **projects**: a named group of threads that share a common base context —
project-level instructions and attached files — automatically applied to every thread in
the project. (Conceptually like Claude/ChatGPT "Projects".)

**Acceptance criteria:**
- Data model via a numbered migration in `src-tauri/migrations/`: a `projects` table,
  per-project **instructions** (text) and **files** (reuse the base64 `attachments`
  pattern, or store text/file content for context), and a nullable `project_id` on
  `threads` (a thread belongs to at most one project; threads can also exist with no
  project). Don't rely on FK cascade — delete children explicitly like `deleteThread`.
- Project instructions + files are injected as base context into every request for threads
  in that project (merged with the per-thread/global system prompt from T10 and the message
  history; mind provider `system`/`systemInstruction` handling).
- Frontend: create/rename/delete projects; the sidebar groups threads by project; a project
  view to edit its instructions and manage its files; creating a thread inside a project
  inherits the base context.
- Typed helpers in `src/lib/db.ts` and store actions in `src/store/threads.ts` (or a new
  projects store); existing project-less threads keep working unchanged.

**Acceptance criteria — edge cases:**
- Large project files don't blow the context window — define a strategy (truncate, select,
  or note as a follow-up) and surface it to the user.
- Deleting a project: decide thread fate (orphan to no-project vs. cascade-delete) and
  confirm destructive actions.

**Notes:**
- Composes with T10 (system-message/memory) — settle precedence: global → project → thread.
- Before changing Anthropic/Gemini request shapes for context injection, consult the
  `claude-api` skill.
- 2026-06-09 (Wave1-T20): Implemented. Migration `002_projects.sql` (version 2) adds
  `projects(id,name,instructions,created_at,updated_at)`, `project_files(id,project_id,name,
  content,created_at)` (text content, not base64 — project files are reference text), and a
  nullable `threads.project_id` (+ indexes). Context injection is done **entirely in the
  frontend** at the message-assembly layer: `store/threads.ts` `send()` loads the project +
  files for a thread's `project_id` and prepends a synthetic `role:"system"` message built by
  the pure helper `buildProjectSystemText` (`src/lib/projects.ts`), ordered before history and
  phrased as context per the `claude-api` skill. **No `src-tauri/src/providers/` changes** —
  this rides the existing `role:"system"` handling (Anthropic top-level `system`, Gemini
  `systemInstruction`, OpenAI/Mistral pass-through). Context-window guard: files included in
  order up to a 100k-char budget, overflow truncated + remainder noted; size meter + warning in
  the project view. Deleting a project **orphans its threads to no-project** (project_id→NULL),
  not cascade-delete; confirmed in the UI. New `src/store/projects.ts`, `src/components/
  projects/ProjectView.tsx`, sidebar grouping in `ThreadList.tsx`, additive `App.tsx` project
  pane. DB helpers + types are additive. Verified: `npm run build`/`lint`/`test` (49 pass, 10
  new for `buildProjectSystemText`/`projectFilesSize`), `cargo build`/`clippy`/`fmt --check`/
  `test` all clean.
