-- T62: per-workspace isolated, toggleable memory.
--
-- workspace_memory mirrors user_memory (005) but scoped to a workspace.
-- Each row is one fact/preference; they are concatenated (in creation order)
-- into an additional system block on every request inside that workspace,
-- alongside the global user_memory and the workspace instructions.
--
-- memory_enabled (INTEGER 0/1, default 1) lets the user disable injection
-- without deleting their entries.
CREATE TABLE IF NOT EXISTS workspace_memory (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    content      TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workspace_memory_workspace
    ON workspace_memory (workspace_id);

-- Per-workspace toggle: 1 = inject memory into system context (default ON).
ALTER TABLE workspaces ADD COLUMN memory_enabled INTEGER NOT NULL DEFAULT 1;
