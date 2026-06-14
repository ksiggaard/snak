-- Per-persona conversation starters: a JSON array of opening-line strings shown
-- as one-tap chips on the empty chat screen for that persona, so its strengths
-- are discoverable. Empty string = no starters. Mirrors other text columns on
-- the bots row (migration 013).
ALTER TABLE bots ADD COLUMN starters TEXT NOT NULL DEFAULT '';
