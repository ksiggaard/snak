# Document attachments

> Part of snak's architecture guide. Core & layer boundary: [`AGENTS.md`](../../AGENTS.md).

- Beyond images, the Composer (and the workspace-files picker) accepts **documents**: clear-text/code files are read directly (`file.text()`); binary formats — pdf, docx, pptx, odt, odp, xlsx, ods — are parsed to plain text by the Rust command `extract_document_text` (`src-tauri/src/commands/documents.rs`; crates `pdf-extract`, `zip`+`quick-xml`, `calamine`). Legacy `.doc`/`.ppt`/`.xls` are rejected with a "save as .docx/…" message. Classification is extension-based (`classifyFile` in `src/lib/documents.ts`) because `File.type` is empty for code files.
- Stored as `attachments` rows with `kind = "document"`, extracted text in `data`, original name in the `filename` column (migration 012). Budgets: 20 MB pre-extraction, 100k chars per document after (`DOCUMENT_CHAR_BUDGET`, truncated with a marker). Attachment text is intentionally not in the FTS index.
- **API injection happens in one seam:** `compactHistory`'s MessageView→ApiMessage mapping appends labeled fenced blocks via `appendDocumentsToContent` — providers are untouched (document text rides in message `content`). Anthropic's native PDF input is deliberately deferred; extracted-text-everywhere is the v1 (ADR-0011).
