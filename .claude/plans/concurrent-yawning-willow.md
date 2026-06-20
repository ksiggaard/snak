# Plan: YouTube tools (search + transcript) as a built-in MCP server

## Context

The user wants the LLM to be able to (a) **search YouTube** and recommend a video as
part of research, and (b) given a **YouTube link, pull the closed captions** so the model
can **summarize the video and answer timestamp questions**.

In this codebase, "capabilities the model can call" are **built-in MCP tools** — Rust
modules under `src-tauri/src/mcp/` (`fetch_url`, `search_web`, `search_images`,
`fetch_images`), each keyless (scrape, no API key) and wired into a built-in server. The
declarative "plugin system" (T12) cannot execute code, so the right home is a built-in MCP
server, exactly like the `web` and `sys` servers.

Per the user's decisions: ship a **separate, toggleable `youtube` built-in server** (its own
entry in Settings → MCP, mirroring `sys`), and **show video thumbnails inline** for search
results (reusing the existing `ToolImage` streaming path that `search_images` uses).

## Tools

1. **`search_youtube`** — args `{ query: string, count?: int (default 5, max 10) }`.
   Scrapes YouTube search results, returns a numbered text list (title · channel · views ·
   duration · watch URL · description snippet) **and** streams up to `count` thumbnails to
   the UI inline via `ImageSink` (each `ToolImage` carries `source_url` = watch URL, `title`
   = video title). This is what lets the model recommend a video with a visible thumbnail.

2. **`youtube_transcript`** — args `{ url: string, lang?: string }` (accepts a full URL or a
   bare video id). Fetches the caption track and returns the transcript as timestamped lines
   `[mm:ss] text …`, length-capped. The timestamps are what enable "summarize" + "what's at
   12:30?" follow-ups. On a video with captions disabled, returns a clear message (the chat
   loop feeds tool errors back as text, so it never aborts the turn).

## Implementation

### Backend — new module `src-tauri/src/mcp/youtube.rs`

Mirror the structure of `src-tauri/src/mcp/image_search.rs`. Keyless, all `reqwest` +
`serde_json` (both already in use). Public surface:

- `pub const SERVER_ID: &str = "youtube";`
- `pub fn tools() -> Vec<ToolDef>` → the two `ToolDef`s above (same `json!` schema style as
  `image_search::search_tool_def`).
- `pub async fn call_tool(client, tool, args, emit_images: ImageSink<'_>) -> anyhow::Result<String>`
  dispatching `search_youtube` / `youtube_transcript`.

**Video-id parsing** (pure, unit-tested): handle `watch?v=`, `youtu.be/<id>`, `/shorts/<id>`,
`/embed/<id>`, and a bare 11-char id.

**`search_youtube`** (scrape, keyless):
- GET `https://www.youtube.com/results?search_query=<q>` with a desktop `user-agent` and a
  `CONSENT=YES+1` cookie (avoids the EU consent interstitial).
- Extract the `ytInitialData = {…};` JSON blob from the HTML, `serde_json::from_str`, then
  walk `contents → …itemSectionRenderer.contents[] → videoRenderer` collecting
  `videoId`, `title.runs[0].text`, `ownerText/longBylineText` (channel),
  `lengthText.simpleText`, `viewCountText.simpleText`, `detailedMetadataSnippets` (snippet).
  Parsing is in a **pure, unit-tested** `parse_search_results(json, count)` fn (feed it a
  fixture `Value`, like `parse_duckduckgo_json` does).
- Build watch URLs (`https://www.youtube.com/watch?v=<id>`) and thumbnail URLs
  (`https://i.ytimg.com/vi/<id>/hqdefault.jpg`); download + base64 the thumbnails and
  `emit_images(...)` them (reuse the download-and-emit pattern from `image_search`; factor a
  shared `download_image` helper or replicate the ~30-line fn — minor duplication is fine).
- Return `format_results(...)` — a numbered, token-friendly list (same shape as
  `web_search::format_results`).

**`youtube_transcript`** (keyless):
- Primary path: POST `https://www.youtube.com/youtubei/v1/player` with the public web
  InnerTube key and the **ANDROID** client `context` (avoids the consent wall and reliably
  returns `captions`). Read
  `captions.playerCaptionsTracklistRenderer.captionTracks[]` (each `{ baseUrl, languageCode,
  kind }`).
- Fallback: GET the watch page and extract `ytInitialPlayerResponse` (same JSON shape) if
  InnerTube returns no captions.
- Pick the track: honor `lang` if given, else prefer a non-`asr` English track, else the
  first track. GET its `baseUrl` → timedtext XML (`<transcript><text start="x" dur="y">…`).
- Parse into `{ start_secs, text }`, decode HTML entities (reuse
  `web_browse::decode_entities` style), format each line `[mm:ss] text`, and cap total
  output at ~20k chars (reuse the `MAX_TEXT_LEN` idea from `web_browse`). The XML parse
  (`parse_timedtext(xml) -> Vec<(f64, String)>`) and `[mm:ss]` formatting are **pure,
  unit-tested**.

### Backend — wire the server into `src-tauri/src/mcp/mod.rs`

- `pub mod youtube;`
- In `builtin_tools(server_id)`: add `youtube::SERVER_ID => youtube::tools(),`.
- In `builtin_call(...)`: add `youtube::SERVER_ID => youtube::call_tool(client, tool, args, emit_images).await,`.
  (`client` and `emit_images` are already in scope there.)
- No approval gating — `requires_approval` stays `sys`-only.

### Frontend — register the built-in server in `src/lib/mcp.ts`

- Add `BUILTIN_YOUTUBE_SERVER: McpServer = { id: "youtube", label: "YouTube (built-in)",
  transport: "builtin", enabled: true, builtin: true }`.
- Add it to `BUILTIN_SERVERS` (after `BUILTIN_WEB_SERVER`). `withBuiltins` already preserves
  a user's toggle and dedupes; `parseServers`/`loadServers`/`enabledServersForChat` need no
  change.

`McpServers.tsx` renders `BUILTIN_SERVERS` generically (toggle + "built-in" badge), so the
new server appears automatically with no UI changes and no new i18n keys (the label lives on
the server object, like the existing built-ins).

## Files

- **New:** `src-tauri/src/mcp/youtube.rs`
- **Edit:** `src-tauri/src/mcp/mod.rs` (module decl + 2 match arms)
- **Edit:** `src/lib/mcp.ts` (one server constant + add to `BUILTIN_SERVERS`)

## Verification

1. `cd src-tauri && cargo test` — unit tests for `parse_video_id`, `parse_search_results`
   (fixture JSON), `parse_timedtext` (fixture XML), and `[mm:ss]` formatting. Add an
   `#[ignore]` live test (like `image_search`'s `live_…`) that runs the real search +
   transcript end-to-end for a known video, gated behind `--ignored`.
2. `cargo clippy` and `cargo build`; `npm run build` (tsc) for the frontend.
3. `npm run tauri dev`: Settings → MCP shows **"YouTube (built-in)"** with a working toggle.
   - Ask the model: *"find me a good video explaining Rust ownership"* → it calls
     `search_youtube`, thumbnails render inline, it recommends one.
   - Paste a YouTube link and ask *"summarize this and tell me when it covers X"* → it calls
     `youtube_transcript` and answers with `[mm:ss]` timestamps.
4. Toggle the server off → confirm those tools disappear (Settings → MCP → Refresh) and chat
   behaves as before.

## Risks / notes

- YouTube scraping is inherently brittle (the same caveat the existing web/image scrapers
  carry). Every parse failure degrades to a clear "no results"/"no captions" string rather
  than erroring, so a bad call never aborts the turn. The InnerTube-first transcript path is
  the more durable of the two; the watch-page scrape is the fallback.
- Transcript text is sent to the chosen model provider (same trust boundary as `fetch_url`);
  no provider gating is added since it's public web content, not local system data.
