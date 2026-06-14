-- T54 response variations: an assistant reply can have several alternative
-- "variants" generated at the same slot. Variants sharing a `variant_group`
-- are alternatives; exactly one has `variant_selected = 1` and is the only one
-- sent as context (the others are kept for browsing but never injected).
--
-- `variant_group` is the id of the group's FIRST (original) variant — so the
-- original row has `variant_group = id`, regenerations copy that id. NULL for
-- user/system rows and synthetic `summary` rows (they never branch).
-- `variant_selected` defaults to 1 so legacy rows and fresh originals are
-- selected by default; a new variant deselects its siblings in app code.
ALTER TABLE messages ADD COLUMN variant_group TEXT;
ALTER TABLE messages ADD COLUMN variant_selected INTEGER NOT NULL DEFAULT 1;

-- Backfill: make every existing assistant chat turn its own singleton group so
-- the regenerate path is uniform (the first variation simply joins the group).
UPDATE messages SET variant_group = id WHERE role = 'assistant' AND kind = 'normal';

CREATE INDEX IF NOT EXISTS idx_messages_variant_group ON messages (variant_group);
