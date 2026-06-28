# T12 — Plugin system (foundation)

- **Status:** done
- **Owner:** Wave1-T12
- **Priority:** P3 (large / architectural)
- **Layer:** Rust + Frontend
- **Depends on:** —

(README idea 5.) An extensibility framework so functionality can be added without core
changes. Plugins are organized by **category**, e.g. "add LLM X support", "Theme",
"Custom skills". This is the umbrella that T11/T14/T15 should plug into.

**Acceptance criteria:**
- A plugin manifest format + category taxonomy, and a defined install/discovery location
  and lifecycle (enable/disable/uninstall).
- A registry/host API plugins register against (at minimum: register a new provider into
  `src/lib/providers.ts` + `src-tauri/src/providers/`, contribute a theme, contribute a
  skill/slash command).
- A settings UI listing installed plugins by category.
- Security/sandboxing model for plugin code is explicitly considered and documented.

**Notes:**
- Big design effort — start with a `brainstorming` + `writing-plans` pass. Sequence before
  T14 (slash commands) and T15 (skills); reconcile with T11 (themes).
- 2026-06-09 (Wave1-T12): Foundation built as **additive scaffolding** — live providers
  untouched (the providers-as-plugins swap stays T18). Design doc:
  `docs/superpowers/specs/2026-06-09-plugin-foundation-design.md`; architecture documented
  in `CLAUDE.md` ("Plugin system (T12 foundation)").
  - **Taxonomy:** `provider | theme | skill | slash-command`.
  - **Manifest** (`manifest.json`): `id, name, version, category, apiVersion(=1),
    description?, author?, enabledByDefault?, contributes?`; pure-fn validation in both
    Rust (`parse_manifest`/`validate_manifest`) and TS (`parseManifest`), unit-tested.
  - **Extension points** (`contributes`): provider `{id,label,defaultModel,keyHint}`,
    theme `{name,css}`, skill `{name,instructions}`, slash-command `{command,description}`.
    Consumers read the `HostRegistry` (`buildRegistry`/`selectRegistry`) — enabled
    contributions grouped by category — not plugin internals. So T18/T11/T15/T14 target
    that seam.
  - **Discovery/state (Rust-owned, filesystem):** built-ins in `plugins/builtin/*.json`
    (four current providers as metadata-only descriptors); user plugins in app-data
    `…/plugins/<id>/manifest.json`; enabled-state in `…/plugins/enabled.json` (NOT the
    settings table — keeps backend authoritative for T18).
  - **Commands:** `list_plugins`, `set_plugin_enabled`, `uninstall_plugin` (user only).
    Frontend: `src/lib/plugins.ts`, `src/store/plugins.ts` (`usePlugins`), settings card
    `src/components/settings/Plugins.tsx` (mounted in `App.tsx`).
  - **Security:** plugins are declarative (manifest + static non-executable assets);
    behavior for provider/slash-command is built-in code keyed by manifest id; no eval /
    dynamic import / plugin binaries; executable third-party plugins (sandbox) deferred.
  - Verified: `npm run build` / `lint` clean, `npm test` 47 pass (+8 new),
    `cargo build` / `clippy` / `fmt --check` clean, `cargo test` 7 plugin tests pass.
