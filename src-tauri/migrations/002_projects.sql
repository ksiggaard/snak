-- Stage T20: projects — grouped threads sharing instructions + reference files.

CREATE TABLE IF NOT EXISTS projects (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL DEFAULT 'New project',
    instructions TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Reference files attached to a project. `content` holds decoded UTF-8 text
-- (project files are injected into the system context as text), distinct from
-- the base64 image-oriented `attachments` table.
CREATE TABLE IF NOT EXISTS project_files (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_files_project
    ON project_files (project_id);

-- A thread belongs to at most one project. NULL = no project (default).
-- ON DELETE CASCADE is intentionally NOT used here: deleting a project orphans
-- its threads (project_id set back to NULL), it does not delete them.
ALTER TABLE threads ADD COLUMN project_id TEXT;

CREATE INDEX IF NOT EXISTS idx_threads_project
    ON threads (project_id);
