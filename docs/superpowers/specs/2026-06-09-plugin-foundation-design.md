# Plugin system foundation (T12) — design

Scaffolds an extensibility framework so functionality (providers, themes, skills,
slash-commands) can be added without core changes. **This wave is additive
scaffolding only** — the existing hardcoded providers keep working unchanged.
Later tasks (T18 providers-as-plugins, T11 themes, T15 skills, T14 slash-commands)
register against the host API defined here.

## Category taxonomy

`PluginCategory = "provider" | "theme" | "skill" | "slash-command"`

- **provider** — "add LLM X support": contributes a provider id/label/defaultModel/keyHint
  (front end) plus a backend stream impl (wired Rust-side in T18).
- **theme** — contributes CSS overriding the documented CSS variables (T11).
- **skill** — contributes packaged instructions/guidance surfaced to the model (T15).
- **slash-command** — contributes a `/command` descriptor handled in the composer (T14).

## Manifest format (`manifest.json`)

```jsonc
{
  "id": "com.kdellm.anthropic",   // unique, stable, reverse-DNS style
  "name": "Anthropic",            // human label
  "version": "1.0.0",             // semver
  "category": "provider",         // one of the taxonomy values
  "apiVersion": 1,                // host API version this plugin targets
  "description": "Claude models", // optional
  "author": "KDE LLM",            // optional
  "enabledByDefault": true,       // optional, default false for user plugins
  "contributes": { /* category-specific descriptor; see extension points */ }
}
```

Parsing/validation is a pure function (`parse_manifest` in Rust, `parseManifest` in
TS) with unit tests: rejects unknown category, missing required fields, mismatched
`apiVersion`.

## Extension points (host/registry API — stubbed this wave)

Typed descriptors in `src/types/plugins.ts`. These are the contracts later waves fill
in; this wave only stores/round-trips them — nothing is wired into chat/theme yet.

- **provider** `ProviderContribution`: `{ id, label, defaultModel, keyHint }`
  (shape-compatible with `ProviderMeta` in `src/lib/providers.ts`). The backend
  stream impl is keyed by `id` in `providers::stream` (added in T18).
- **theme** `ThemeContribution`: `{ name, css }` — CSS text (or app-data file path)
  overriding `src/index.css` variables.
- **skill** `SkillContribution`: `{ name, instructions }`.
- **slash-command** `SlashCommandContribution`: `{ command, description }`.

A `HostRegistry` interface (`src/lib/plugins.ts`) exposes `register*` stubs returning
the enabled contributions per category, so consumers depend on the registry, not the
plugin internals. This wave returns the contributions of enabled plugins; full wiring
(e.g. feeding providers into `providers.ts`) is T18/T11/T15/T14.

## Discovery, install location & lifecycle

- **Built-in plugins**: declared in Rust (`builtin_plugins()`), always present,
  `source = "builtin"`, can be disabled but **not** uninstalled. This wave seeds the
  four current providers as built-in *descriptors* (metadata only — does not replace
  the live hardcoded providers; that swap is T18).
- **User plugins**: discovered from the app-data dir `…/plugins/<id>/manifest.json`
  (resolved via `AppHandle::path().app_data_dir()`), `source = "user"`, uninstallable.
- **Enabled/disabled state**: persisted as JSON in app-data `…/plugins/enabled.json`
  (`{ [id]: bool }`). Owned by **Rust** (filesystem + app-data is a backend concern per
  the layer boundary), so Rust stays authoritative for discovery *and* enablement —
  this is what later waves need to source enabled providers. Absent id → manifest's
  `enabledByDefault`. (Chosen over the `settings` table so all plugin state lives in
  one place the backend owns; documented in CLAUDE.md.)
- **Lifecycle**: list / enable / disable / uninstall. Uninstall removes a user plugin's
  folder; built-ins reject uninstall.

## Rust commands (`src-tauri/src/plugins/mod.rs`, module `plugins`)

- `list_plugins() -> Vec<PluginInfo>` — built-ins + discovered user plugins, each
  merged with its enabled state.
- `set_plugin_enabled(id, enabled)` — writes `enabled.json`.
- `uninstall_plugin(id)` — removes a user plugin folder; errors on built-ins.

`PluginInfo = { manifest: PluginManifest, source: "builtin" | "user", enabled: bool }`.

## Frontend

- `src/types/plugins.ts` — manifest, category, contribution, `PluginInfo` types.
- `src/lib/plugins.ts` — command wrappers (`listPlugins`, `setPluginEnabled`,
  `uninstallPlugin`), `parseManifest`/validation, and the `HostRegistry` stub.
- `src/store/plugins.ts` — Zustand store: `plugins`, `load`, `setEnabled`, `uninstall`;
  selectors grouping by category.
- `src/components/settings/Plugins.tsx` — settings card listing installed plugins
  grouped by category with enable/disable toggles + uninstall (user plugins). Mounted
  in `App.tsx`'s settings panel.

## Security / sandboxing model (explicit)

**v1 ships only trusted built-ins, and user plugins are declarative-only.** A plugin
is a manifest plus *static, non-executable* assets (CSS text, instruction strings,
provider/slash-command *descriptors*). The host never loads or executes arbitrary
plugin code. Behavior for `provider`/`slash-command` categories is provided by
**built-in Rust/TS code keyed by manifest id** — a user-supplied manifest can only
*describe* a contribution, not ship runnable logic. Consequences:

- No `eval`, no dynamic `import()` of plugin JS, no spawning plugin binaries.
- Theme CSS is injected into the webview but cannot run script (CSS only); it is
  applied via a `<style>` element, not raw HTML, so no markup/script injection.
- Slash-commands that run OS actions (e.g. T14 `/terminal`) execute **built-in Rust**
  gated by confirmation/allowlist — never code carried by the plugin.
- Manifests are validated (schema + `apiVersion`) before use; invalid ones are skipped.

**Out of scope / future:** executable third-party plugins would require a real sandbox
(WASM component model or a permission-scoped subprocess) and a capability/permission
prompt. That is explicitly deferred; the manifest's `apiVersion` lets a future host
gate on it.

## Testing

Pure logic only (no Tauri runtime): manifest parse/validate in both Rust
(`cargo test`) and TS (`vitest`) — valid manifest, unknown category, missing field,
wrong `apiVersion`, enabled-state merge defaulting.
