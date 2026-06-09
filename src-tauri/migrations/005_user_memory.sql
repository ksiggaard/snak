-- T10: persistent "memory about the user" injected into the system context.
--
-- A small set of free-text memory entries the user maintains in Settings. Each
-- row is one fact/preference; they are concatenated (in creation order) into a
-- leading system message on every request, alongside the global system-prompt
-- addendum (which lives in the `settings` table as `system_prompt_addendum`).
--
-- Kept as a table (rather than a single settings blob) so individual memories
-- can be added/edited/removed independently in the UI. No FK relationships.
CREATE TABLE IF NOT EXISTS user_memory (
    id         TEXT PRIMARY KEY,
    content    TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_memory_created
    ON user_memory (created_at);
