-- Artifacts: LLM-generated multi-file web apps emitted in a ```artifact fenced
-- block. One row per artifact block in an assistant message; the block's files
-- are stored as a JSON array in `files` ([{path, content}]) so in-app edits are
-- atomic (mirroring how tool_call/subagent payloads serialize). Keyed by
-- (message_id, ordinal) so the inline card resolves a stable record across
-- reloads even when a message contains several artifacts. Children are deleted
-- explicitly by the frontend (FK CASCADE is not relied upon).
CREATE TABLE IF NOT EXISTS artifacts (
    id         TEXT PRIMARY KEY,
    thread_id  TEXT NOT NULL,
    message_id TEXT NOT NULL,
    ordinal    INTEGER NOT NULL DEFAULT 0,
    title      TEXT NOT NULL DEFAULT '',
    files      TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (message_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_artifacts_thread ON artifacts (thread_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_message ON artifacts (message_id);
