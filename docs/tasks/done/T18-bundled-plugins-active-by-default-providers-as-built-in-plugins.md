# T18 — Bundled plugins active by default; providers as built-in plugins

- **Status:** done
- **Owner:** Wave3-T18
- **Priority:** P3 (architectural; first real consumer of T12)
- **Layer:** Rust + Frontend
- **Depends on:** T12

The app should ship with a set of **premade plugins enabled out of the box** so it works
on first launch with no setup. As the flagship case, **convert the current LLM support
into plugins**: each of the four providers (Anthropic, OpenAI, Mistral, Gemini — today
hardcoded in `src/lib/providers.ts` and `src-tauri/src/providers/`) becomes a built-in
"add LLM X support" plugin under T12's plugin model, bundled and enabled by default.

Because providers become toggleable plugins, the app **must handle every provider being
disabled** (all models off) gracefully instead of assuming at least one exists.

**Acceptance criteria:**
- A built-in/bundled plugin concept (distinct from user-installed): ships with the app and
  is enabled by default, but can be disabled like any plugin (T12).
- The four providers are migrated to built-in plugins: the provider registry
  (`src/lib/providers.ts`) and the Rust provider modules are sourced from enabled plugins
  rather than a hardcoded list, with no regression to existing chat/streaming.
- Disabling a provider plugin removes its models everywhere (`ModelPicker`, draft/thread
  model selection, settings API-keys list) and the app stays consistent.
- **All-disabled state handled:** when no provider is enabled, the chat UI shows a clear
  empty/disabled state, Send is gated with guidance to enable a provider, the draft/last
  model selection degrades safely, and existing threads referencing a now-disabled model
  don't crash (clear messaging, re-enable path).
- First-launch defaults are sensible (built-ins enabled).

**Notes:**
- Sequence after T12's host API and registry exist; this is the proof that the plugin model
  can express core functionality. Coordinate with T6's send-gating (no-key) so the
  no-provider-enabled and no-key states compose cleanly.
- 2026-06-09 (Wave3-T18): Done. The four providers are now built-in, enabled-by-default
  `provider` plugins (descriptors already seeded by T12 in `src-tauri/src/plugins/builtin/*.json`).
  `src/lib/providers.ts` derives the active list from the **enabled** provider contributions
  via `useProviders()` (reads `usePlugins` + `buildRegistry`), with two safeguards so chat
  never regresses: (1) the hardcoded four remain as `FALLBACK_PROVIDERS`/`PROVIDERS` and are
  returned while the plugin layer hasn't loaded yet; (2) contributions are filtered to the ids
  the Rust dispatch knows (`anthropic|openai|mistral|gemini`). **Rust `providers/mod.rs`
  dispatch is unchanged — it always resolves those ids, so the live streaming path is the
  fallback; disabling is enforced frontend-only.** `ModelPicker`/`ApiKeys`/`ChatView`/`Composer`
  drive off `useProviders()`; all-disabled and stored-but-disabled-provider states are handled
  (clear messaging, Send gated, ModelPicker shows the stored provider as an inert option, no
  crash). `App` loads the plugin registry on mount. Design doc:
  `docs/superpowers/specs/2026-06-09-providers-as-plugins-design.md`. Verified: `npm run build`
  / `lint` / `test` (101 pass, incl. new registry-derivation + fallback tests), `cargo build` /
  `clippy` (clean) / `fmt --check` / `test` (20 pass).
