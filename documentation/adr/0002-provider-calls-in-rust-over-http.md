# 0002. Provider calls run in Rust over raw HTTP

- **Status:** Accepted
- **Date:** 2026-06-28

## Context

Each provider (Anthropic, OpenAI, Mistral, Gemini, Ollama) needs streaming chat completions.
Two layers could make the call: the webview (fetch from JS) or the Rust backend. Calling
from the webview means the API key has to be in the webview ([ADR 0001](./0001-api-keys-in-os-keychain.md)
rules that out) and runs into browser CORS for several provider endpoints. SDKs add weight
and lag behind API changes.

## Decision

Make provider HTTP calls in **Rust with `reqwest`**, no vendor SDKs. Each provider is a
module in `src-tauri/src/providers/` implementing a one-method `Provider` trait, **`stream(...)`**,
which streams text deltas over a Tauri `Channel<StreamDelta>` and returns the accumulated
`{content, model}`. SSE is parsed by a shared UTF-8-safe line driver (`for_each_sse_data` in
`providers/mod.rs`). `providers::complete`/`stream` dispatch by id. Per-provider quirks
(Anthropic `system` + `anthropic-version`; Gemini `model` role + `x-goog-api-key`) live in
their own modules.

## Consequences

- The key stays in Rust; no CORS; no SDK version drift. Raw HTTP per provider docs.
- Adding a provider = a module implementing `Provider::stream` + a match arm in
  `providers::stream` + an entry in `src/lib/providers.ts`. OpenAI/Mistral share
  `openai::chat_completions` (Mistral is OpenAI-compatible).
- We own the SSE parsing and per-provider request shaping (more code, full control).
- The command surface is one call, `chat_stream(provider, model, messages, on_delta)`
  (`commands/chat.rs`); the frontend owns persistence ([ADR 0003](./0003-frontend-owns-the-database.md)).
