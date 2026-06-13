-- T43 @-mentions: persona attribution for one-shot, in-character replies.
-- Nullable: NULL = a normal reply (the thread's persona or none) — renders
-- unchanged. No FK/cascade reliance (mirrors threads.bot_id, migration 013):
-- deleting a bot NULLs this column explicitly in the frontend's deleteBot.
ALTER TABLE messages ADD COLUMN bot_id TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_bot ON messages (bot_id);
