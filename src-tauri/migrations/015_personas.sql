-- T40 personas: structured profile fields, self-managed memory + mood.
ALTER TABLE bots ADD COLUMN modus_operandi TEXT NOT NULL DEFAULT '';
ALTER TABLE bots ADD COLUMN tone_of_voice TEXT NOT NULL DEFAULT '';
-- Persona may add/update/delete its own bot_memory rows after each exchange.
ALTER TABLE bots ADD COLUMN auto_memory INTEGER NOT NULL DEFAULT 1;
-- Persistent mood, updated by the same follow-up call, injected into context.
ALTER TABLE bots ADD COLUMN mood_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bots ADD COLUMN mood TEXT NOT NULL DEFAULT '';
-- Who created a memory row: 'user' (editor) or 'auto' (the persona itself).
ALTER TABLE bot_memory ADD COLUMN source TEXT NOT NULL DEFAULT 'user';
