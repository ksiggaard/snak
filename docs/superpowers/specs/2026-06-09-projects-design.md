> 📐 **Historical design doc.** A dated, point-in-time design record — kept for the
> rationale, not as current truth. For how the feature works today,
> [`AGENTS.md`](../../../AGENTS.md) is canonical; where this doc and the code disagree,
> the code wins.
>
> 🔁 **Renamed:** "projects" shipped and was later renamed to **workspaces** (migration `022`:
> `projects`→`workspaces`, `project_files`→`workspace_files`, `threads.project_id`→`workspace_id`).
> See [AGENTS.md §Workspaces](../../../AGENTS.md#workspaces). This doc keeps the original "projects" naming.

# T20 — Projects (grouped threads with shared instructions + files)

## Goal

Introduce **projects**: a named group of threads sharing base context (project-level
instructions + reference files) that is automatically injected into every request for
threads in the project. Conceptually like Claude/ChatGPT "Projects". Project-less threads
keep working unchanged.

## Data model (migration `002_projects.sql`, version 2)

```sql
CREATE TABLE projects (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL DEFAULT 'New project',
    instructions TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE project_files (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    content    TEXT NOT NULL,            -- decoded text, injected into context
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_project_files_project ON project_files (project_id);

ALTER TABLE threads ADD COLUMN project_id TEXT;   -- nullable; NULL = no project
CREATE INDEX idx_threads_project ON threads (project_id);
```

- **Project files store text, not base64.** Project files are *reference text* merged into
  the system context, so we store decoded UTF-8 text in a dedicated `project_files` table
  rather than the image-oriented `attachments` table (which is base64 + keyed to a message).
- FK `ON DELETE CASCADE` is declared for documentation but **not relied upon** (the plugin
  connection may lack `PRAGMA foreign_keys = ON`) — children are deleted explicitly, mirroring
  `deleteThread`.

## Context injection

In `store/threads.ts` `send()`: if the current thread has a `project_id`, load the project +
its files and build a synthetic `system` message, prepended to the API `history`. This rides
the **existing** `role: "system"` handling in all four providers (Anthropic top-level
`system`, Gemini `systemInstruction`, OpenAI/Mistral pass-through) — **no Rust/provider
changes**.

Per the `claude-api` skill: project context is phrased **as context, not commands**, and is
ordered **before** conversation history.

A pure helper `buildProjectSystemText(project, files)` (in `src/lib/projects.ts`) assembles:

```
Project: <name>

<instructions>

The following project files are provided as reference context:

--- <file name> ---
<file content>
...
```

Precedence is left composable for T10 (global → project → thread): T10 can prepend/append its
own system text around this block.

## Context-window strategy

`buildProjectSystemText` truncates the assembled context to a character budget
(`PROJECT_CONTEXT_CHAR_BUDGET = 100_000`). Files are included in order until the budget is hit;
an overflow file is truncated with a `…[truncated]` marker, and remaining files are dropped with
a note. The project view surfaces a running size indicator and a warning when over budget. Pure
function → unit-tested.

## Project deletion

Deleting a project **orphans its threads to no-project** (`project_id = NULL`) and deletes the
project + its files. Threads (chat history) are valuable and surprising to lose; cascade-deleting
them is rejected. Destructive action is confirmed in the UI.

## Frontend

- New store `src/store/projects.ts` (`useProjects`): `projects`, `currentProjectId`, actions
  `init`, `create`, `rename`, `setInstructions`, `addFile`, `removeFile`, `remove`,
  `selectProject`, `openProject`. Owns project CRUD + file management.
- `src/store/threads.ts`: `send()` gains project-context injection; new action
  `assignThreadProject(threadId, projectId | null)`; `startNewChatInProject(projectId)` seeds
  the draft's `project_id` so the first message creates the thread inside the project.
- `src/lib/db.ts`: additive helpers — `listProjects`, `createProject`, `getProject`,
  `renameProject`, `setProjectInstructions`, `deleteProject` (explicit child deletes + orphan
  threads), `listProjectFiles`, `addProjectFile`, `deleteProjectFile`, `setThreadProject`.
  `createThread` accepts optional `project_id`; thread queries select the new column.
- `src/types/db.ts`: `Project`, `ProjectFile` types; `Thread.project_id: string | null`.
- `src/components/projects/`: `ProjectView` (edit name/instructions, manage files, size meter)
  and grouping pieces.
- `src/components/sidebar/ThreadList.tsx`: groups threads by project (collapsible project
  headers with project threads nested; ungrouped threads below), new-project button, open a
  project's view, new-chat-in-project.
- `src/App.tsx`: additive — route the main pane to `ProjectView` when a project is open
  (alongside the existing chat / settings panes).

## Testing

- Unit-test `buildProjectSystemText`: empty project (no files), instructions only, files
  labeled + ordered, truncation at the char budget, overflow file dropped with note.
- `npm run build`, `npm run lint`, `npm test`; `cargo build`/`clippy`/`fmt --check`.

## What is explicitly NOT touched

- No `src-tauri/src/providers/` changes. No new Tauri command (DB stays in the frontend per
  Stage 1). `lib.rs` change is limited to the migration registry entry.
