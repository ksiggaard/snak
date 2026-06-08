-- Stage 1: initial schema for threads, messages, attachments, and settings.

CREATE TABLE IF NOT EXISTS threads (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL DEFAULT 'New chat',
    provider   TEXT NOT NULL,
    model      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    thread_id  TEXT NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_thread
    ON messages (thread_id, created_at);

-- Image (and future) attachments. `data` holds either a base64 payload or an
-- app-data file path, distinguished by `kind`/`media_type`.
CREATE TABLE IF NOT EXISTS attachments (
    id         TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    media_type TEXT NOT NULL,
    data       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attachments_message
    ON attachments (message_id);

-- Non-secret app preferences (selected provider/model, theme, hotkey, ...).
-- API keys are NOT stored here — they live in the OS keychain (Stage 2).
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
