-- Per-project quick actions: a project may define its own set of empty-screen
-- quick actions that overrides the global list (stored in the `settings` table)
-- for chats in that project. JSON array of { id, label, prompt, mode }; an empty
-- string means "no override — use the global actions". Mirrors the project's
-- `instructions` column: plain text on the project row.
ALTER TABLE projects ADD COLUMN quick_actions TEXT NOT NULL DEFAULT '';
