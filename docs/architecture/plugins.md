# Plugin system

> Part of snak's architecture guide. Core & layer boundary: [`AGENTS.md`](../../AGENTS.md).

Extensibility framework with **two distinct plugin kinds** (don't conflate them):

1. **Declarative plugins** — a `manifest.json` + static, non-executable assets, no `entry`. The
   host never runs their code; behavior is built-in Rust/TS keyed by manifest `id`/language
   (ADR-0004). The **5 declarative built-ins** are loaded via `builtin_manifests()` (`include_str!`
   in `src-tauri/src/plugins/mod.rs`): `ollama` (provider), `terminal` (slash-command), `youtube`
   and `artifacts` (renderers), `audio`.
2. **Runtime plugins** — **executable, trusted JS**: an ESM module exporting `activate(ctx)`,
   declared by an `entry` field in the manifest. These *do* run code; they are **unsandboxed**
   and `permissions` is advisory ergonomics, **not** a security boundary (ADR-0007;
   `src/types/pluginApi.ts`). The **4 bundled runtime built-ins** ship under
   `src-tauri/resources/plugins/<id>/` (built by `npm run build:plugins`) and are seeded into
   app-data on startup (`seed_bundled_plugins`, seed-if-absent): `com.snak.mermaid`,
   `com.snak.charts`, `com.snak.maps`, and `com.snak.hello` (a sample). Users install more from a
   `.zip`. *(Note: charts/maps/mermaid moved declarative → runtime; the leftover
   `builtin/charts.json` and `builtin/maps.json` are not loaded by `builtin_manifests()`.)*

The declarative foundation is below; the runtime API and trust model follow it. Design doc:
`docs/superpowers/specs/2026-06-09-plugin-foundation-design.md`.

- **Category taxonomy:** `provider` ("add LLM X") · `theme` · `slash-command` · `renderer` (fenced-code renderers, T42) · `audio` (`PluginCategory` in `src/types/plugins.ts`; `CATEGORIES` in Rust). **Skills are not a plugin category** — they're standalone `SKILL.md` folders (see [Skills](./skills.md)).
- **Manifest** (`manifest.json`): `{ id, name, version, category, apiVersion, description?, author?, enabledByDefault?, contributes?, entry?, permissions?, dependencies? }`. `entry`/`permissions` mark a **runtime** plugin (executable JS); `contributes` marks a **declarative** one. `apiVersion` must equal the host's `API_VERSION` (currently `1`). Validation is a pure fn in **both** layers — `parse_manifest`/`validate_manifest` (`src-tauri/src/plugins/mod.rs`) and `parseManifest` (`src/lib/plugins.ts`), each unit-tested.
- **Declarative extension points** (`contributes`, category-specific descriptors): `provider` → `{ id, label, defaultModel, keyHint }` (shape-compatible with `ProviderMeta`); `theme` → `{ name, css }`; `slash-command` → `{ command, description }`; `renderer` → `{ language }`. The `HostRegistry` (`buildRegistry` in `src/lib/plugins.ts`, `selectRegistry` selector in `src/store/plugins.ts`) is the seam consumers read — it returns the contributions of **enabled** declarative plugins grouped by category, so consumers depend on the registry, not plugin internals. `hasRenderer(reg, lang)` is the renderer lookup `CodeBlock` uses for the declarative built-ins. (Runtime plugins register their contributions in code instead — see below.)
- **Discovery & state (Rust-owned, filesystem):** declarative built-ins are declared in Rust (`builtin_manifests()`, `include_str!` from `src-tauri/src/plugins/builtin/*.json`). Bundled runtime built-ins ship as resources and are copied into app-data on startup (`seed_bundled_plugins`, seed-if-absent so a user-uninstalled bundled plugin stays gone). All other plugins (and the seeded copies) live in app-data `…/plugins/<id>/manifest.json` (resolved via `AppHandle::path().app_data_dir()`). Enabled/disabled state is a JSON map in app-data `…/plugins/enabled.json` (absent id → manifest `enabledByDefault`) — kept Rust-side (not the `settings` table) so the backend stays authoritative for discovery *and* enablement. (Cloud providers are user-added custom providers, not plugins — see [Secrets / API keys](../../AGENTS.md#secrets--api-keys).)
- **Lifecycle / commands** (`src-tauri/src/plugins/`, module `plugins`, registered in `lib.rs`): `list_plugins` (built-ins + user, merged with enabled state), `set_plugin_enabled(id, enabled)`, `uninstall_plugin(id)` (user plugins only — built-ins reject), plus the runtime trio `read_plugin_entry` (read a plugin's `entry` JS source), `import_plugin` (validate + extract a `.zip`, zip-slip-safe + size-capped, `plugins/runtime.rs`), `pick_plugin_zip` (native file picker). Frontend: wrappers in `src/lib/plugins.ts`, `usePlugins` store (`src/store/plugins.ts`), and the **Plugins** settings card (`src/components/settings/Plugins.tsx`).

## Runtime plugins — loading & trust

- **Loading** (`src/lib/pluginLoader.ts`): for each enabled runtime plugin (topologically sorted by `dependencies`, `src/lib/pluginDeps.ts`), the loader reads the `entry` JS via `read_plugin_entry`, wraps it in a `Blob` (`text/javascript`), `await import(/* @vite-ignore */ url)`s it (the `@vite-ignore` is mandatory or Rollup tries to resolve the blob at build time), and calls `mod.activate(ctx)`. A failing plugin is logged and skipped — never breaks the app. Teardown via `teardownPlugin` (`pluginHost.ts`).
- **The `ctx` API** (`src/types/pluginApi.ts`): a plugin codes only against the `PluginContext` the host builds for it (`contextFor`, `pluginHost.ts`) — no host globals, no host-module imports. `ctx.ui.registerRenderer(language, mount)` draws a fenced block as a custom view; `ctx.ui.registerUi(slot, mount)` adds UI into `header`/`message-toolbar`/`sidebar`/`settings`; `ctx.storage` is a per-plugin `KVStore` backed by the `plugin_storage` table (migration `031`, namespaced by plugin id, **not** cascaded on uninstall so reinstalls resume). Runtime contributions land in the `useContributions` registry (`src/store/contributions.ts`: `renderers`, `uiSlots`, `llmHooks`).
- **Security / trust model:** **declarative** plugins run no code — the host supplies behavior keyed by `id`/language (no `eval`, no dynamic `import()` of *their* code; ADR-0004). **Runtime** plugins are the opposite: **unsandboxed, trusted JS** that the host genuinely executes. `permissions` is advisory ergonomics (the host just declines to populate undeclared parts of `ctx`), **not** a security boundary — installing a runtime plugin is trusting its author with the app's full privileges. What *is* enforced (in Rust, `plugins/runtime.rs`) is filesystem hygiene: zip-slip-safe, size-capped extraction and entry reads confined to the plugin's own folder. This trade-off is recorded in **ADR-0007**.
- **Renderer example — mermaid:** `com.snak.mermaid`'s `activate(ctx)` calls `ctx.ui.registerRenderer("mermaid", mount)`, so a ` ```mermaid ` fence renders as a diagram. `CodeBlock` (`src/components/chat/CodeBlock.tsx`) checks the runtime `renderers` registry first (any language a plugin registered), then the declarative `artifacts` built-in (`hasRenderer(registry, ARTIFACT_LANGUAGE)` → `ArtifactCard`), then falls back to a highlighted block. *(A stale `CodeBlock` comment still calls mermaid "the only built-in renderer" — it's now a runtime plugin.)*
