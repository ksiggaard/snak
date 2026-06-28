# T39 — Document attachments: multi-format files in chats and projects

- **Status:** done
- **Owner:** Claude (T36–T39 wave)
- **Priority:** P2
- **Layer:** Rust (binary-format parsing) + Frontend (attach flow)
- **Depends on:** —

(IDEAS 12.) Attach more than images: any clear-text format (source code, md, csv, json,
…) plus parsed binary documents — pdf, docx, odt, ods, odp, ppt(x), xlsx — in both chat
messages and project files. Documents need to be parsed to text the model can read.

**Acceptance criteria:**
- **Chat attach flow:** `Composer.tsx` `addFiles` (currently filters to `image/*`) accepts
  documents; text-like files are read directly; binary formats go through a Rust
  `extract_document_text(bytes, media_type)` command returning extracted plain text
  (crates: e.g. `pdf-extract`/`lopdf` for pdf, `docx-rs` or zip+XML for docx/odt/odp/pptx,
  `calamine` for xlsx/ods — pick and document). Unsupported/failed parses surface a clear
  inline error, never a silent drop.
- **Storage:** reuse the `attachments` table (`kind = "document"`, `media_type`, extracted
  text in `data`; extend the schema via a numbered migration if a filename column is
  needed). The API payload injects the document text with a labeled wrapper (filename +
  fenced content); decide and document a per-document size budget like T20's 100k-char
  project budget.
- **Native provider documents where supported:** Anthropic supports PDF input natively —
  consult the `claude-api` skill before deciding raw-PDF-to-Anthropic vs extracted text
  everywhere; extracted-text-everywhere is the acceptable v1.
- **Projects:** the T20 project-files picker accepts the same formats, running the same
  extraction into `project_files.content` (text), so project context "just works".
- **UI:** attached documents render as a chip/card (filename, type icon, size) on the user
  message in `MessageList.tsx` and in the Composer's pending-attachment row. Note FTS
  implications (attachment text is not in `search_fts` — fine, document it).

**Notes:**
- Keep parsing in Rust (the webview has no fs access or heavy parsers); legacy binary
  `.doc`/`.ppt` (pre-OOXML) are hard — explicitly out of scope or best-effort, document
  the decision.
- Mind context-window blowups — show a size meter/warning like the project view (T20).
- 2026-06-12 (Claude): Done. **Rust** (`commands/documents.rs`): `extract_document_text`
  command (base64 in, `spawn_blocking`) over pure `detect_format`/`extract_text` —
  `pdf-extract` 0.10 under `catch_unwind` for pdf; `zip` 8.6 (deflate-only) +
  `quick-xml` 0.40 for docx/pptx/odt/odp (text capture gated to `w:t`/`a:t`/`text:p`
  subtrees so markup whitespace doesn't leak; pptx slides numerically ordered with
  `--- Slide N ---` separators); `calamine` 0.35 for xlsx/ods (per-sheet headers,
  tab-joined rows). Legacy `.doc`/`.ppt`/`.xls` are **out of scope** — classified
  frontend-side as `legacy-document` with a "save as .docx/…" error. 8 cargo tests
  with in-test-generated fixtures (incl. a hand-written minimal PDF; no binaries
  committed). Migration **012**: `attachments.filename TEXT`.
- 2026-06-12: **Frontend**: `src/lib/documents.ts` — extension-based `classifyFile`
  (File.type is empty for code files), 20 MB pre-extraction cap, **100k chars/doc**
  budget (`truncateDocumentText` + marker), `buildDocumentBlock` (labeled, fence =
  longest backtick run + 1) and `appendDocumentsToContent`. **Single injection seam:**
  `compactHistory`'s MessageView→ApiMessage mapping appends the blocks to `content` —
  covers sends, reloads, and compaction with zero provider changes (Anthropic native
  PDF deferred per the AC; `claude-api` consulted). `MessageView.documents` from
  `kind="document"` rows; `send(content, images, documents)` persists them (title falls
  back to the first document's name). Composer: classifier-driven `addFiles` (extraction
  on attach, spinner, inline per-file errors — nothing silently dropped; paste/drag
  accept any file), document chips with ext badge + char count; `canSend` blocks while
  extracting. MessageList renders chips in all chat styles (no click in v1 — only
  extracted text is stored). ProjectView routes binary docs through the same extraction
  into `project_files.content`. FTS: attachment text intentionally unindexed (noted in
  the migration header). 9 i18n keys in all five packs. Verified: npm build/lint/test
  (353) + cargo build/clippy/fmt/test (64) green; CLAUDE.md gained a T39 section.
