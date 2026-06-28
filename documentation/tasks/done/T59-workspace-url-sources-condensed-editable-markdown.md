# T59 — Workspace URL sources → condensed editable markdown

- **Status:** done
- **Owner:** Claude (T59)
- **Priority:** P2
- **Layer:** Rust (fetch + HTML→markdown) + Frontend (workspace UI)
- **Depends on:** T58
- **Notes (2026-06-17):** Migration 023 adds nullable `source_url TEXT` to
  `workspace_files` — the canonical provenance seam for T60 (YouTube) and T63
  (workspace dashboard). New Rust command `fetch_url_as_markdown` in
  `src-tauri/src/commands/url.rs` fetches the URL over HTTP, converts HTML to
  structure-preserving markdown (headings, lists, links, bold/em, code, fenced
  pre; nav/footer/script/style stripped) with a front-matter provenance header,
  capped at the 100k-char workspace budget. No new crate needed — pure
  hand-rolled parser extending the `web_browse` approach. Frontend:
  `src/lib/url.ts` wrapper + `validateUrl` helper; URL input + "Add URL" button
  in `WorkspaceView`; globe icon for URL-sourced files with clickable source
  link. All 5 locale packs updated. Gate: `npm run build/lint/test` all pass
  (633 tests); `cargo build/clippy/fmt --check/test` all pass (170 tests, only
  pre-existing mcp/mod.rs too-many-args warning). Live-URL fetch deferred to
  manual testing (network not available in unit-test gate).

(IDEAS 3b.) Let a workspace accept **URLs** as content sources. Adding a URL fetches the
page and converts it to a condensed **markdown** file stored in the workspace, editable like
any other workspace file, with the source URL recorded. Broadens the "multiple file formats"
support already started by T39 (documents).

**Acceptance criteria:**
- An add-URL affordance in the workspace view; on add, the Rust side fetches the URL and
  converts HTML → condensed markdown (reuse/extend the readable-text path behind
  `fetch_url`; add an HTML→markdown step — no such converter exists yet).
- Stored as a `workspace_files` row with the source URL recorded, editable in the file UI
  exactly like an uploaded file.
- Char budgeting consistent with `DOCUMENT_CHAR_BUDGET` / `projectFilesSize` handling.
