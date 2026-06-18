-- Per-message model tracking: store which provider/model generated each
-- message. NULL means "inherited from the owning thread" (backward compat).
ALTER TABLE messages ADD COLUMN provider TEXT;
ALTER TABLE messages ADD COLUMN model TEXT;

-- Planner mode per thread: 1 = planner orchestrates sends for this thread.
ALTER TABLE threads ADD COLUMN planner_active INTEGER NOT NULL DEFAULT 0;
-- Saved pre-planner provider/model so the user can toggle out of planner
-- mode and restore their original selection.
ALTER TABLE threads ADD COLUMN pre_planner_provider TEXT;
ALTER TABLE threads ADD COLUMN pre_planner_model TEXT;
