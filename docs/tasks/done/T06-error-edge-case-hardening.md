# T6 — Error & edge-case hardening

- **Status:** done
- **Owner:** Agent B
- **Priority:** P2
- **Layer:** Frontend + Rust
- **Depends on:** —

Tighten failure UX across the chat path.

**Acceptance criteria:**
- Friendly, actionable errors for: missing API key for the selected provider, network
  failure, provider HTTP/4xx/5xx (surface the provider's error message), and empty/invalid
  model selection.
- Sending is disabled (with a hint) when the selected provider has no stored key
  (`has_api_key`).
- Long/empty/whitespace-only messages and very large pasted images are handled gracefully.

**Notes:**
- 2026-06-09 (Agent B): Errors routed through the store `error` field via a `friendlyError`
  mapper that classifies the raw provider/Tauri message: missing key and empty-model are
  surfaced from Rust with actionable text ("Add one in Settings."); reqwest failures →
  "Network error…"; provider HTTP statuses (401/403/404/429/5xx) get tailored guidance while
  still appending the provider's returned body (each provider module already returns
  `"<provider> error <status>: <body>"` on non-2xx — verified). `chat_stream` rejects an
  empty/whitespace model up front. Send is gated when the selected provider has no stored
  key (`hasApiKey`, re-checked when the provider changes) with a hint in `Composer`; empty/
  whitespace-only sends are a no-op (store + Composer); image prep failures (oversized/
  unsupported) are caught and shown inline instead of throwing. Verified: `npm run build`/
  `lint`, `cargo build`/`clippy`/`fmt` all pass.
