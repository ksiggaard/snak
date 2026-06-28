# T52 — Web search for small models (search_web tool, configurable backend)

- **Status:** done
- **Owner:** Claude (T52)
- **Priority:** P2
- **Layer:** Rust (extend built-in `web` MCP server) + Frontend (settings + key)
- **Depends on:** T13 (MCP + built-in web server)

(IDEA 23.) Small models can't guess the URLs to `fetch_url`. Extend the built-in `web`
server with a `search_web` tool so the model can search → get URLs → fetch them. Backend is
**configurable**: keyless DuckDuckGo by default, optional API-key provider (Brave/Serper).

**Acceptance criteria:**
- A `web__search_web` tool returning a ranked title/URL/snippet list for a query.
- Default keyless backend (works out of the box); switchable to a keyed provider whose API
  key is stored in the keychain (never in the webview).
- The tool-call loop and no-tools invariant are unchanged; the system prompt nudges
  search-then-fetch.

**Notes:**
- 2026-06-13 (Claude): New `src-tauri/src/mcp/web_search.rs` — `tool_def()` (the `search_web`
  descriptor) + `search(client, args, provider)` dispatching by backend: **DuckDuckGo** (keyless,
  scrapes `html.duckduckgo.com/html/`, pure `parse_duckduckgo_html`/`decode_ddg_href`/
  `percent_decode` helpers, unit-tested), **Brave** (`api.search.brave.com`, `X-Subscription-Token`)
  and **Serper** (`google.serper.dev`, `X-API-KEY`) reading the key in-process via
  `keys::get_api_key("search.<provider>")`. `web_browse::tools()` now advertises both tools and
  `web_browse::call_tool` gained a `search_provider: Option<&str>` param routed from `mcp::mod`'s
  `ServerConfig.search_provider` (new `#[serde(default)]` field) through `builtin_call`. No
  `chat_stream` signature change — the backend rides on the web server's config entry.
  `TOOL_SYSTEM_PROMPT` (`commands/chat.rs`) updated to mention search-then-fetch. Frontend:
  `McpServer.search_provider` (snake_case to match the nested Rust field) defaulting to
  `duckduckgo` on the built-in web server (preserved through `withBuiltins`); a provider `<select>`
  + keyed-provider API-key field in the web server's row in `settings/McpServers.tsx`
  (`setSearchApiKey` → keychain account `search.<id>`). New `mcp.search*` i18n keys in the catalog
  + all five packs. Search is defensive (parse failures → "no results" text, fed back as a tool
  result, never aborting the turn). Verified: `cargo build`/`clippy`/`fmt`/`test` (83, +7
  web_search), `npm run build`/`lint`/`test` (461).
