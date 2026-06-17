-- T58: rename projects → workspaces end-to-end.
--
-- SQLite's ALTER TABLE … RENAME automatically updates references inside
-- foreign-key constraints and indexes that target the renamed table/column,
-- so existing rows and associations are fully preserved.
--
-- Index names are NOT auto-renamed (they keep their old internal names but
-- remain functionally correct because they point at the renamed objects).
-- We drop and recreate them with workspace-aligned names for cleanliness.

-- 1. Rename the tables.
ALTER TABLE projects RENAME TO workspaces;
ALTER TABLE project_files RENAME TO workspace_files;

-- 2. Rename the foreign-key column inside workspace_files.
ALTER TABLE workspace_files RENAME COLUMN project_id TO workspace_id;

-- 3. Rename the thread association column.
ALTER TABLE threads RENAME COLUMN project_id TO workspace_id;

-- 4. Recreate indexes with workspace-aligned names.
--    (The old idx_project_files_project / idx_threads_project are still
--    present under their old names but now point at the renamed columns;
--    we drop them and create fresh ones.)
DROP INDEX IF EXISTS idx_project_files_project;
DROP INDEX IF EXISTS idx_threads_project;

CREATE INDEX IF NOT EXISTS idx_workspace_files_workspace
    ON workspace_files (workspace_id);

CREATE INDEX IF NOT EXISTS idx_threads_workspace
    ON threads (workspace_id);
