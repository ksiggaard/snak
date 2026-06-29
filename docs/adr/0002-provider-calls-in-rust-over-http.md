# ADR-0002: Provider calls run in Rust over raw HTTP

* Status: accepted
* Deciders: snak core team
* Date: 2026-06-28

## Context and Problem Statement

Every provider (Anthropic, OpenAI, Mistral, Gemini, Ollama) needs streaming chat completions. Two layers could make the outbound call: the webview (JS `fetch`) or the Rust backend. Calling from the webview forces the API key into the webview — which [ADR-0001](./0001-api-keys-in-os-keychain.md) rules out — and runs into browser CORS on several provider endpoints. We must decide where the HTTP call lives and whether to use vendor SDKs.

## Decision Drivers

* Key confidentiality — the key must never enter the webview ([ADR-0001](./0001-api-keys-in-os-keychain.md))
* Avoid browser CORS restrictions on provider endpoints
* Avoid SDK weight and version drift as provider APIs change
* Full control over SSE streaming and per-provider request shaping

## Considered Options

* **Option 1:** Rust backend with `reqwest`, raw HTTP, no vendor SDKs
* **Option 2:** Webview `fetch` from JavaScript
* **Option 3:** Vendor SDKs (per-provider client libraries)

## Decision Outcome

Chosen option: **Option 1 — Rust + `reqwest`, raw HTTP**, because it is the only option that keeps the key in Rust, sidesteps CORS entirely, and avoids coupling to SDK release cycles. Each provider is a module in `src-tauri/src/providers/` implementing a one-method `Provider` trait, **`stream(...)`**, which streams text deltas over a Tauri `Channel<StreamDelta>` and returns the accumulated `{content, model}`. SSE is parsed by a shared, UTF-8-safe line driver (`for_each_sse_data` in `providers/mod.rs`); `providers::complete`/`stream` dispatch by id. Per-provider quirks (Anthropic `system` + `anthropic-version`; Gemini `model` role + `x-goog-api-key`) live in their own modules.

### Consequences

* **Positive:** The key stays in Rust, there is no CORS, and there is no SDK version drift. The command surface is a single call, `chat_stream(provider, model, messages, on_delta)` (`commands/chat.rs`). Adding a provider is mechanical: a module implementing `Provider::stream` + a match arm in `providers::stream` + an entry in `src/lib/providers.ts` (OpenAI/Mistral share `openai::chat_completions`, since Mistral is OpenAI-compatible).
* **Negative:** We own the SSE parsing and per-provider request shaping ourselves — more code and more maintenance than delegating to an SDK, and provider API changes must be tracked by hand. Persistence is deliberately not handled here; the frontend owns it ([ADR-0003](./0003-frontend-owns-the-database.md)).

## Pros and Cons of the Options

### Option 1 — Rust + `reqwest`, raw HTTP

* **Good:** Key never leaves Rust; no CORS; no SDK version coupling.
* **Good:** Full control over streaming, headers, and per-provider quirks.
* **Good:** One narrow command surface (`chat_stream`).
* **Bad:** We maintain SSE parsing and request shaping for every provider by hand.

### Option 2 — Webview `fetch`

* **Good:** Simplest path; streaming via the browser's native `fetch`/`ReadableStream`.
* **Bad:** Requires the API key in the webview, violating [ADR-0001](./0001-api-keys-in-os-keychain.md).
* **Bad:** Browser CORS blocks several provider endpoints.

### Option 3 — Vendor SDKs

* **Good:** Less hand-written request/SSE code; provider-maintained shapes.
* **Bad:** Adds dependency weight and lags behind API changes.
* **Bad:** Most SDKs assume a server/Node environment, not a Rust/Tauri host, and still don't solve the key-location problem.
