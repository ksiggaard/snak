-- Per-message output type (response-style): record which output type was active
-- when each assistant reply was generated, so the model pill's hover detail can
-- show the exact style that shaped that reply (not just the thread's current
-- setting, which may have changed since). NULL = unknown/legacy row (older
-- replies generated before this column existed); treated as 'default' in the UI.
-- Mirrors the per-message provider/model tracking from migration 028.
ALTER TABLE messages ADD COLUMN output_type TEXT;
