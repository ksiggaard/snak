---
name: add-provider
description: How to add an LLM provider to snak — a no-code preset for an OpenAI-compatible service, or a new wire protocol that needs a Rust module. Use when asked to "add support for <provider>", add a provider preset, or wire up a non-OpenAI/Anthropic/Gemini API.
---

# Adding a provider to snak

snak ships **no cloud providers** — users add them as custom-provider rows (ADR-0010). There are
two cases. Figure out which one you're in **first**.

## Case A — an OpenAI-compatible service (the common case: no Rust needed)

OpenAI, Mistral, Groq, OpenRouter, DeepSeek, Together, … all speak the OpenAI
`chat/completions` wire protocol. They differ only by base URL, default model, and key. You do
**not** write Rust — you add a preset for convenience.

1. Add an entry to **`src/lib/providerPresets.ts`** with `{ id, label, protocol: "openai", baseUrl, defaultModel, keyHint }`. Match the shape of the existing presets.
2. That's it — the user picks it from **Settings → Custom Providers**, which creates a `CustomProvider` row (`{id,label,protocol,baseUrl,defaultModel}`) in the `settings` table. The Rust `openai::chat_completions_stream` engine handles the call against `baseUrl`.
3. Verify: `npm run build` (typecheck) and try it in `npm run tauri dev`.

If the service is OpenAI-compatible, **stop here**. Don't add a Rust module.

## Case B — a genuinely new wire protocol (rare: needs Rust)

Only when the API is *not* OpenAI-compatible and *not* Anthropic/Gemini (which already have native
modules). You're adding a new value to `ProviderProtocol` and a backend module.

1. **Rust module** — add `src-tauri/src/providers/<name>.rs` implementing the `Provider` trait's one method, `stream(...)` (stream text deltas over the `Channel<StreamDelta>`, return `{content, model}`). Parse SSE with the shared `for_each_sse_data` driver in `providers/mod.rs`. Mirror an existing module (`anthropic.rs` / `gemini.rs`) for the request-shaping and header quirks.
2. **Dispatch arm** — add a `"<name>" =>` arm in `providers::stream` (`src-tauri/src/providers/mod.rs`). Ollama dispatches by `provider` id; everything else by the wire `protocol`.
3. **Protocol value** — add `"<name>"` to `ProviderProtocol` in **`src/lib/db.ts`**.
4. **Settings `<select>`** — add the option in `src/components/settings/CustomProviders.tsx`.
5. **Preset** (optional) — add a `providerPresets.ts` entry with `protocol: "<name>"`.
6. Verify: `cargo clippy` + `cargo fmt` in `src-tauri/`, then `npm run build`.

## When Anthropic/Claude is involved

Before touching Anthropic request shapes, model ids, streaming, or multimodal, consult the
`claude-api` skill — don't rely on memory (per `AGENTS.md`).

## Reference

- ADR-0002 (provider calls in Rust over HTTP), ADR-0010 (custom providers, not plugins).
- `AGENTS.md` §Providers & chat, §Secrets / API keys.
