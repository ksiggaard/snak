# Web search

> Part of snak's architecture guide. Core & layer boundary: [`AGENTS.md`](../../AGENTS.md).

- A built-in tool (`web__search_web`, `src-tauri/src/mcp/web_search.rs`) with pluggable backends selected on the `web` server config (`search_provider`): `duckduckgo` (default, keyless, HTML scrape), `brave`, and `serper` (JSON APIs whose keys live in the OS keychain under `search.brave` / `search.serper`, read in-process — never the webview).
- Results surface to the model as a numbered list and to the UI as clickable `ToolSource` objects.
