# 0001. API keys live in the OS keychain

- **Status:** Accepted
- **Date:** 2026-06-28

## Context

snak is bring-your-own-key: users paste provider API keys for Anthropic, OpenAI, Mistral,
Gemini. Those keys are long-lived secrets. Storing them in the SQLite database, in
`localStorage`, or anywhere the webview can read them means any XSS or a leaked DB file
hands an attacker the user's keys. The webview is the least-trusted layer.

## Decision

Store provider keys in the **OS keychain** via the `keyring` crate (macOS Keychain /
Windows Credential Manager / Linux Secret Service, selected per-platform in `Cargo.toml`).
Service name `com.snak.app`, account = provider id. The webview never receives a key:
`has_api_key` returns only a **bool**, and the Rust chat path fetches the key in-process
(`keys::get_api_key`, crate-internal) when streaming.

## Consequences

- Keys never touch the DB, `localStorage`, or the webview — XSS and a leaked `snak.db` no
  longer expose them.
- Key handling is Rust-only: `set_api_key` / `has_api_key` / `delete_api_key`
  (`src-tauri/src/commands/keys.rs`), with thin frontend wrappers in `src/lib/keys.ts`.
- The UI can show whether a key is set but can never display or export it.
- Tied to a native keychain → no key sync across machines (acceptable; keys are per-device).
