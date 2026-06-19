-- Library artifacts (T??): saved independent artifact copies untethered from
-- any thread or message. Users can save an artifact from a chat, in-app edits
-- are written back here, and the sidebar Artifacts pane lists them for reuse.
CREATE TABLE IF NOT EXISTS library_artifacts (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    files      TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
