-- Favorite chats (T23). A per-thread flag so the user can pin conversations to
-- a Favorites group at the top of the sidebar. Existing threads default to
-- not-favorited; the column is additive (SELECT * picks it up everywhere).
ALTER TABLE threads ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
