-- Output type (response-style picker): a per-thread choice that shapes how the
-- model replies (short/detailed/JSON/plain-text/etc.) by injecting one system
-- instruction at send time. Persisted per thread like deep_research/favorite so
-- reopening a thread keeps the selection. 'default' = no instruction (the
-- model's natural style). Existing threads default to 'default'. Setting it does
-- NOT bump updated_at.
ALTER TABLE threads ADD COLUMN output_type TEXT NOT NULL DEFAULT 'default';
