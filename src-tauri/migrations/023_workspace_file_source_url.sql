-- T59: add source_url column to workspace_files.
--
-- URL-ingested files set this to the page URL; uploaded files leave it NULL.
-- This column is the canonical provenance seam reused by T60 (YouTube) and
-- T63 (workspace dashboard "urls" list).

ALTER TABLE workspace_files ADD COLUMN source_url TEXT;
