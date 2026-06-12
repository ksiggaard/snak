-- T39: document attachments. Original filename for kind='document' rows
-- (NULL for images/tool_calls). Attachment text is intentionally NOT indexed
-- in search_fts (004) — search covers message text only.
ALTER TABLE attachments ADD COLUMN filename TEXT;
