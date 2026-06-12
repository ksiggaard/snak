-- T38: bots — user-created personas with avatars and per-bot memory.
CREATE TABLE IF NOT EXISTS bots (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL DEFAULT 'New bot',
    instructions      TEXT NOT NULL DEFAULT '',
    -- Uploaded avatar, base64 (no data: prefix) + MIME; both NULL = monogram fallback.
    avatar_media_type TEXT,
    avatar_data       TEXT,
    -- Optional default provider/model new chats with this bot inherit (both set or both NULL).
    default_provider  TEXT,
    default_model     TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Cascade declared but NOT relied upon — deleteBot removes children explicitly.
CREATE TABLE IF NOT EXISTS bot_memory (
    id         TEXT PRIMARY KEY,
    bot_id     TEXT NOT NULL REFERENCES bots (id) ON DELETE CASCADE,
    content    TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bot_memory_bot ON bot_memory (bot_id, created_at);
-- A thread optionally belongs to a bot; deleting a bot orphans threads (bot_id → NULL).
ALTER TABLE threads ADD COLUMN bot_id TEXT;
CREATE INDEX IF NOT EXISTS idx_threads_bot ON threads (bot_id);
