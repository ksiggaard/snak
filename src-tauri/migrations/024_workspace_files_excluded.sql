-- T61: per-chat workspace file selection.
--
-- Add a nullable column to threads that stores a JSON array of workspace-file
-- ids the user has de-selected for this chat. NULL (or an empty array "[]")
-- means nothing is excluded — all files are injected (default-all-selected).
--
-- This "store excluded" model gives the right semantics automatically:
--   - New threads start with NULL → all files included.
--   - Files added to the workspace later are not in the excluded set → auto-included.

ALTER TABLE threads ADD COLUMN workspace_files_excluded TEXT;
