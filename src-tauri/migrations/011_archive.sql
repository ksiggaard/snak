-- Chats as tabs: closing a chat (the X on its sidebar row) archives it —
-- it leaves the open list but keeps all history, and opening it from the
-- Archive group promotes it back to open (archived = 0). Existing threads
-- default to open. Archiving does NOT bump updated_at, so promoting/archiving
-- never reorders the recency list.
ALTER TABLE threads ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
