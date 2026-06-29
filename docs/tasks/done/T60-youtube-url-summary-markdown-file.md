# T60 — YouTube URL → summary markdown file

- **Status:** done
- **Owner:** Claude (T60)
- **Priority:** P3
- **Layer:** Rust (reuse caption fetch + new summarize) + Frontend
- **Depends on:** T58, T59, the built-in YouTube MCP server (`youtube`)

(IDEAS 3c.) When YouTube is enabled, adding a YouTube URL to a workspace creates an editable
markdown file containing an LLM **summary of the video built from its captions**, with the
source URL in a front-matter/meta section. Caption access already exists and must be
**reused**, not rebuilt: `youtube_transcript` in `src-tauri/src/mcp/youtube.rs` fetches a
video's closed-caption track (InnerTube `/youtubei/v1/player`, falling back to scraping
`ytInitialPlayerResponse`) and parses the timedtext XML. **Only the summarize step is new.**

**Acceptance criteria:**
- Gated on the built-in `youtube` MCP server being enabled — so the feature can be turned
  off (when disabled, adding a YouTube URL falls back to the generic URL ingestion from T59).
- Adding a YouTube URL reuses the existing `youtube_transcript` caption-fetch path to get the
  transcript, summarizes it via the model, and stores an editable markdown file (front-matter:
  URL + summary).
- Videos without captions degrade gracefully (clear message, no crash), mirroring
  `youtube_transcript`'s existing "no captions available" handling.

**Notes (2026-06-17):** Implemented. New Rust command `fetch_youtube_transcript(url) ->
{ title, transcript, no_captions }` in `commands/url.rs` reuses `mcp::youtube`'s
`parse_video_id`, `select_track`, `parse_timedtext`, and `format_transcript` — no caption
logic was duplicated. Gated in `WorkspaceView.tsx` by checking `loadServers()` for the
`"youtube"` server's `enabled` flag; when disabled, falls through to the T59
`fetchUrlAsMarkdown` path unchanged. Summarization calls `chatStream` with the app's
`defaultProvider` / `defaultModel` (from `useThreads`) and the transcript as the user
message; result is not persisted to any thread. Videos without captions return `no_captions:
true` from the Rust command and show `workspace.youtubeNoCaptions` in the UI. New i18n keys
(`youtubeNoCaptions`, `youtubeSummarizeError`) added to the English catalog and all 5 packs.
Pure helpers (`buildYoutubeMarkdown`, `youtubeFileName`, `YOUTUBE_SUMMARY_SYSTEM_PROMPT`)
unit-tested in `youtube.test.ts`. Gate: `npm run build` + `lint` + `vitest run` (642 tests
pass); `cargo build` + `clippy` (0 new warnings) + `fmt --check` all clean.
