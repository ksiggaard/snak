-- T19: full-text search over chat history (thread titles + message content).
--
-- We use a SQLite **FTS5** virtual table rather than LIKE scans so search stays
-- fast on large histories. FTS5 availability is guaranteed here: tauri-plugin-sql
-- links sqlx-sqlite → libsqlite3-sys, whose bundled SQLite is compiled with
-- `-DSQLITE_ENABLE_FTS5` (verified in libsqlite3-sys build.rs). The frontend
-- keeps a LIKE fallback only as defence-in-depth if a query ever errors.
--
-- One FTS row per searchable unit, tagged by `kind`:
--   * 'title'   → a thread's title          (message_id = '')
--   * 'message' → one message's content      (message_id = the message id)
-- `thread_id`/`message_id`/`kind` are UNINDEXED (stored, not tokenized) so we can
-- join back to threads/messages and filter without bloating the index. `text` is
-- the only indexed column. `porter unicode61` gives stemmed, case-insensitive,
-- diacritic-folding matching.
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5 (
    text,
    kind UNINDEXED,
    thread_id UNINDEXED,
    message_id UNINDEXED,
    tokenize = 'porter unicode61'
);

-- Keep the index in sync with TRIGGERS (chosen over app-side writes so the index
-- can never drift from the source tables, regardless of which code path mutates
-- them — the frontend store, a future migration, or a manual fix). Because rows
-- are tagged by kind and reference no rowid alias, we delete-then-insert on
-- update. message_id is '' for title rows.

-- Messages ---------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS search_fts_messages_ai
AFTER INSERT ON messages BEGIN
    INSERT INTO search_fts (text, kind, thread_id, message_id)
    VALUES (new.content, 'message', new.thread_id, new.id);
END;

CREATE TRIGGER IF NOT EXISTS search_fts_messages_ad
AFTER DELETE ON messages BEGIN
    DELETE FROM search_fts
    WHERE kind = 'message' AND message_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS search_fts_messages_au
AFTER UPDATE ON messages BEGIN
    DELETE FROM search_fts
    WHERE kind = 'message' AND message_id = old.id;
    INSERT INTO search_fts (text, kind, thread_id, message_id)
    VALUES (new.content, 'message', new.thread_id, new.id);
END;

-- Threads (titles) -------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS search_fts_threads_ai
AFTER INSERT ON threads BEGIN
    INSERT INTO search_fts (text, kind, thread_id, message_id)
    VALUES (new.title, 'title', new.id, '');
END;

CREATE TRIGGER IF NOT EXISTS search_fts_threads_ad
AFTER DELETE ON threads BEGIN
    DELETE FROM search_fts WHERE kind = 'title' AND thread_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS search_fts_threads_au
AFTER UPDATE OF title ON threads BEGIN
    DELETE FROM search_fts WHERE kind = 'title' AND thread_id = old.id;
    INSERT INTO search_fts (text, kind, thread_id, message_id)
    VALUES (new.title, 'title', new.id, '');
END;

-- Backfill any rows that already exist (threads/messages created before v4).
INSERT INTO search_fts (text, kind, thread_id, message_id)
SELECT title, 'title', id, '' FROM threads;

INSERT INTO search_fts (text, kind, thread_id, message_id)
SELECT content, 'message', thread_id, id FROM messages;
