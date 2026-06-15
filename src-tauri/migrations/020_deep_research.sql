-- Deep research mode (T55, idea #26): a per-thread toggle that lets the model
-- dispatch parallel research subagents (each with its own context + web tools)
-- to investigate a question, then synthesize their concise summaries. Persisted
-- per thread (like favorite/archived) so reopening a thread keeps the mode.
-- Existing threads default to off. Toggling does NOT bump updated_at.
ALTER TABLE threads ADD COLUMN deep_research INTEGER NOT NULL DEFAULT 0;
