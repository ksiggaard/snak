# ADR-0003: The frontend owns the database

* Status: accepted
* Deciders: snak core team
* Date: 2026-06-28

## Context and Problem Statement

Chat history lives in on-device SQLite (`tauri-plugin-sql`). Both layers *could* write it: the Rust streaming command could persist messages as it streams, or the React frontend could own all SQL. We need a single, unambiguous owner — splitting writes across layers means two places construct rows, two places stay schema-aware, and ordering races between "stream finished in Rust" and "store updated in JS."

## Decision Drivers

* Single source of truth for persistence (one place builds rows)
* No write-ordering races between the Rust stream and the JS store
* Keep Rust stateless w.r.t. chat history — easier to reason about and test
* Clean alignment with the streaming boundary in [ADR-0002](./0002-provider-calls-in-rust-over-http.md)

## Considered Options

* **Option 1:** The frontend owns all SQL; Rust never touches the DB
* **Option 2:** The Rust streaming command persists messages as it goes
* **Option 3:** Split writes — Rust persists assistant text, frontend persists everything else

## Decision Outcome

Chosen option: **Option 1 — the frontend owns all SQL**, because it gives one owner for the full message lifecycle and removes any cross-layer ordering race. Access goes through typed helpers in `src/lib/db.ts` (one connection via `getDb()`); domain types in `src/types/db.ts`. The Zustand store (`src/store/threads.ts`) persists the user message, gathers history, calls `chatStream`, then persists the returned authoritative assistant text. The Rust `chat_stream` command **never touches the DB** — it only streams and returns text.

### Consequences

* **Positive:** One owner for persistence; the store orchestrates the message lifecycle end to end (a placeholder `STREAM_ID` message during streaming, swapped for the persisted row on completion). Rust stays stateless with respect to chat history, which is easier to reason about and test.
* **Negative:** `DB_URL` (`sqlite:snak.db`) is duplicated in `src-tauri/src/lib.rs` and `src/lib/db.ts` and must be kept in sync. The frontend reads/writes rows but never schema — migrations remain Rust-registered and run at startup, so schema and row ownership live in different layers. FK `ON DELETE CASCADE` is not relied on (the plugin connection may lack `PRAGMA foreign_keys = ON`), so `deleteThread` removes children explicitly.

## Pros and Cons of the Options

### Option 1 — Frontend owns all SQL

* **Good:** Single owner for persistence; no cross-layer write races.
* **Good:** Rust stays stateless and simpler to test.
* **Good:** The store can manage optimistic UI (`STREAM_ID`) and the authoritative row in one place.
* **Bad:** `DB_URL` is duplicated across layers; schema (Rust migrations) and rows (frontend) are owned separately.

### Option 2 — Rust persists during streaming

* **Good:** Assistant text is durable even if the webview crashes mid-stream.
* **Bad:** Rust must become schema-aware and stateful, contradicting [ADR-0002](./0002-provider-calls-in-rust-over-http.md)'s narrow streaming role.
* **Bad:** Re-introduces ordering coordination between the Rust write and the JS store.

### Option 3 — Split writes across both layers

* **Good:** Each layer writes the rows it most directly produces.
* **Bad:** Two places construct rows and stay schema-aware — the exact duplication and race risk this decision exists to avoid.
