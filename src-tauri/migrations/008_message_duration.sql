-- Per-assistant-reply generation time in milliseconds. Nullable: pre-existing
-- rows, user messages, and synthetic notes have no duration.
ALTER TABLE messages ADD COLUMN duration_ms INTEGER;
