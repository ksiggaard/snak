-- T16: token usage tracking. One row per assistant response, recording the
-- provider, model, and token counts captured from the streaming API response.
--
-- Usage is attributed to the *model that actually produced the response* (the
-- captured `model`, falling back to the thread's model), so historical rows
-- stay correct even when a thread's provider/model later changes.
--
-- `message_id` is the assistant message the usage belongs to (the natural key,
-- one row per response). `thread_id` is denormalized for fast per-thread rollups
-- and so rows survive in aggregate queries. ON DELETE CASCADE is intentionally
-- NOT relied upon (the plugin connection may not have PRAGMA foreign_keys = ON);
-- deleteThread removes usage rows explicitly.
CREATE TABLE IF NOT EXISTS usage (
    id                    TEXT PRIMARY KEY,
    message_id            TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    thread_id             TEXT NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
    provider              TEXT NOT NULL,
    model                 TEXT NOT NULL,
    input_tokens          INTEGER NOT NULL DEFAULT 0,
    output_tokens         INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_usage_message ON usage (message_id);
CREATE INDEX IF NOT EXISTS idx_usage_thread ON usage (thread_id);
CREATE INDEX IF NOT EXISTS idx_usage_model ON usage (model);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage (created_at);
