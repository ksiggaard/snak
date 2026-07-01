# Workspaces

> Part of snak's architecture guide. Core & layer boundary: [`AGENTS.md`](../../AGENTS.md).

A **workspace** groups threads that share base context — instructions, reference files, and optional memory — conceptually like Claude/ChatGPT "Projects". (It was literally named *projects* originally; migration `022` renamed `projects`→`workspaces`, `project_files`→`workspace_files`, `threads.project_id`→`threads.workspace_id`.) **Not** to be confused with the per-thread *skill* workspace (a scratch-file sandbox — see [Skills](./skills.md)).

- **Data:** `workspaces` (id, name, `instructions`, `memory_enabled`, `quick_actions`, profile/cover images + positions), `workspace_files` (optional `source_url` for URL-ingested files), `workspace_memory` (migrations `022`–`029`). A thread can exclude specific workspace files (`024`). Store: `src/store/workspaces.ts`; SQL helpers in `src/lib/db.ts`.
- **Injection:** a workspace's instructions + files feed the system context for its threads (the same `loadSharedSystemBlocks` seam in `src/store/threads.ts` that carries the skills index).
