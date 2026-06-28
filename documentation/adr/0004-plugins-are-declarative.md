# 0004. Plugins are declarative (no code execution)

- **Status:** Accepted
- **Date:** 2026-06-28

## Context

snak wants extensibility — providers, themes, slash-commands, renderers — without core
changes. The dangerous version of this is loading third-party **code**: `eval`, dynamic
`import()` of plugin JS, or spawning plugin binaries. That needs a real sandbox
(WASM/subprocess) plus a permission model, and one bad plugin compromises the app.

## Decision

Plugins are **declarative**: a `manifest.json` plus static, non-executable assets (CSS text,
instruction strings, descriptors). The host **never loads or executes arbitrary plugin code**.
`provider` / `slash-command` / `renderer` *behavior* is built-in Rust/TS keyed by the
manifest `id`/language; a manifest only advertises and configures it. Theme CSS is injected
via a `<style>` element (CSS only). Manifests are validated by a pure function in both layers
(`parse_manifest`/`validate_manifest` in `src-tauri/src/plugins/mod.rs`, `parseManifest` in
`src/lib/plugins.ts`); `apiVersion` must equal the host's `API_VERSION`.

## Consequences

- No `eval`, no dynamic `import()` of plugin code, no plugin binaries — the attack surface of
  a third-party plugin is a static manifest.
- A contribution with no built-in handler is discoverable but inert (e.g. a plugin
  slash-command with no built-in behavior posts an explanatory note instead of running).
- Genuinely executable third-party plugins are **deferred** until there's a WASM/subprocess
  sandbox + permission prompt; `apiVersion` lets a future host gate on it.
- Discovery/enablement is Rust-owned on the filesystem (`builtin_manifests()`, app-data
  `plugins/<id>/manifest.json`, `plugins/enabled.json`); consumers read the `HostRegistry`
  seam (`buildRegistry` in `src/lib/plugins.ts`), not plugin internals.
