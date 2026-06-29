# ADR-0001: API keys live in the OS keychain

* Status: accepted
* Deciders: snak core team
* Date: 2026-06-28

## Context and Problem Statement

snak is bring-your-own-key: users paste long-lived provider API keys (Anthropic, OpenAI, Mistral, Gemini) into the app. The webview is the least-trusted layer — any XSS, or a leaked database file, must not expose those secrets. We need a storage location for provider keys that the webview can neither read nor exfiltrate.

## Decision Drivers

* Secret confidentiality — keys must survive XSS and a leaked `snak.db`
* Least privilege for the webview (the largest attack surface)
* Cross-platform native secret storage without bespoke crypto

## Considered Options

* **Option 1:** OS keychain via the `keyring` crate (Rust-side)
* **Option 2:** The on-device SQLite database (`snak.db`)
* **Option 3:** Browser `localStorage` / webview-accessible storage

## Decision Outcome

Chosen option: **Option 1 — OS keychain via `keyring`**, because it is the only option that keeps the key out of every webview-reachable surface. Keys are stored per-platform (macOS Keychain / Windows Credential Manager / Linux Secret Service, selected in `Cargo.toml`) under service name `com.snak.app` with account = provider id. The webview never receives a key: `has_api_key` returns only a **bool**, and the Rust chat path fetches the key in-process (`keys::get_api_key`, crate-internal) when streaming.

### Consequences

* **Positive:** Keys never touch the DB, `localStorage`, or the webview — XSS and a leaked `snak.db` no longer expose them. The UI can show whether a key is set but can never display or export it. Key handling is Rust-only and minimal: `set_api_key` / `has_api_key` / `delete_api_key` (`src-tauri/src/commands/keys.rs`) with thin frontend wrappers in `src/lib/keys.ts`.
* **Negative:** Keys are bound to a native per-device keychain, so there is no key sync across machines (accepted; keys are per-device). A live OS keychain is also required, which adds a platform dependency to local development and testing.

## Pros and Cons of the Options

### Option 1 — OS keychain via `keyring`

* **Good:** Secrets live outside any webview-reachable store; immune to XSS and DB exfiltration.
* **Good:** Uses the platform's vetted secret store — no custom crypto or key management.
* **Good:** Forces a clean boundary (the key never crosses into JS).
* **Bad:** No cross-device sync; depends on a functioning native keychain per platform.

### Option 2 — SQLite database

* **Good:** Trivial to implement; reuses the existing persistence layer.
* **Good:** Naturally per-device, consistent with the rest of the data model.
* **Bad:** A leaked `snak.db` file hands an attacker every key.
* **Bad:** Plaintext-at-rest (or app-managed encryption with a key that must itself be stored somewhere).

### Option 3 — `localStorage` / webview storage

* **Good:** Simplest possible access from the frontend.
* **Bad:** Directly readable by any injected script — one XSS exposes all keys.
* **Bad:** Concentrates secrets in the least-trusted layer, the opposite of least privilege.
