# ADR-0004: Plugins are declarative (no code execution)

* Status: accepted
* Deciders: snak core team
* Date: 2026-06-28

## Context and Problem Statement

snak wants extensibility — providers, themes, slash-commands, renderers — without core changes. The dangerous version of this loads third-party **code** (`eval`, dynamic `import()` of plugin JS, or spawning plugin binaries), which would require a real sandbox plus a permission model, and where one bad plugin can compromise the whole app. We need an extension mechanism whose worst case is bounded.

## Decision Drivers

* Security — the attack surface of a third-party plugin must be minimal
* Extensibility without modifying core code
* Implementation cost — avoid building a sandbox and permission system now

## Considered Options

* **Option 1:** Declarative plugins — a manifest plus static, non-executable assets; behavior is built-in and keyed by manifest id/language
* **Option 2:** Dynamic code loading — `eval` / dynamic `import()` of plugin JS / plugin binaries, with no sandbox
* **Option 3:** Executable plugins inside a WASM/subprocess sandbox with a permission prompt

## Decision Outcome

Chosen option: **Option 1 — declarative plugins**, because it delivers the needed extension points while reducing a plugin's attack surface to a static manifest, and avoids building a sandbox we don't yet need. A plugin is a `manifest.json` plus static, non-executable assets (CSS text, instruction strings, descriptors). The host **never loads or executes arbitrary plugin code**: `provider` / `slash-command` / `renderer` *behavior* is built-in Rust/TS keyed by the manifest `id`/language, and a manifest only advertises and configures it. Theme CSS is injected via a `<style>` element (CSS only). Manifests are validated by a pure function in both layers (`parse_manifest`/`validate_manifest` in `src-tauri/src/plugins/mod.rs`, `parseManifest` in `src/lib/plugins.ts`), and `apiVersion` must equal the host's `API_VERSION`.

### Consequences

* **Positive:** No `eval`, no dynamic `import()` of plugin code, no plugin binaries — the attack surface of a third-party plugin is a static manifest. Discovery and enablement are Rust-owned on the filesystem (`builtin_manifests()`, app-data `plugins/<id>/manifest.json`, `plugins/enabled.json`); consumers read the `HostRegistry` seam (`buildRegistry` in `src/lib/plugins.ts`), not plugin internals.
* **Negative:** Extension *behavior* is limited to what the host already implements — a contribution with no built-in handler is discoverable but inert (e.g. a plugin slash-command with no built-in behavior posts an explanatory note instead of running). Genuinely executable third-party plugins are **deferred** until there is a WASM/subprocess sandbox plus permission prompt; `apiVersion` lets a future host gate on it.

## Pros and Cons of the Options

### Option 1 — Declarative plugins

* **Good:** Worst case of a malicious plugin is a static manifest — no code runs.
* **Good:** Delivers provider/theme/slash-command/renderer extension points with no new runtime.
* **Good:** Validation is a pure, dual-layer function; `apiVersion` gives forward gating.
* **Bad:** Plugins can only configure built-in behavior, not introduce genuinely new logic.

### Option 2 — Dynamic code loading (no sandbox)

* **Good:** Maximum flexibility — plugins can ship arbitrary behavior.
* **Bad:** A single malicious or buggy plugin compromises the entire app.
* **Bad:** `eval`/dynamic `import()`/binaries are precisely the attack surface this decision removes.

### Option 3 — Sandboxed executable plugins

* **Good:** Combines arbitrary behavior with bounded risk.
* **Bad:** Requires building a WASM/subprocess sandbox plus a permission model — significant cost for no current need (explicitly deferred).
