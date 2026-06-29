# T32 — Language packs (i18n), bundled + user-installable

- **Status:** done
- **Owner:** Agent-T32
- **Priority:** P3 (large — touches every UI string)
- **Layer:** Frontend (i18n layer) + Rust (pack discovery) + plugins
- **Depends on:** T12 (category/registry alignment)

(IDEAS 5.) Localize the UI via language packs: ship **English, German, French, Polish,
Spanish, and Danish** out of the box, with packs as plain JSON files in a known folder so
anyone can add their own language without code changes.

**Acceptance criteria:**
- An i18n layer for the frontend: UI strings externalized to keyed message catalogs with
  an English fallback for missing keys. (Pick and document the mechanism — a small
  homegrown `t(key)` + Zustand store is fine; avoid heavyweight deps if possible.)
- Pack format: one JSON file per language (`<bcp47>.json`, e.g. `de.json`) with
  `{ name, code, strings: { key: text } }`. Bundled packs for en/de/fr/pl/es/da ship with
  the app; user packs are discovered from an app-data `…/languages/` folder (mirror the
  T11 themes-folder loader: Rust `list_languages` command + validation, bad files
  skipped). Built-in packs could alternatively be `language`-category T12 plugin
  contributions — align with the declarative plugin model and document the decision.
- A language selector in Settings (persisted; default = system locale when a pack
  matches, else English). Switching applies live or after reload — decide and document.
- Untranslated keys render the English string, never the raw key. A `docs/` note explains
  how to author and install a pack.

**Notes:**
- The big cost is sweeping every component for hardcoded strings — consider landing the
  i18n layer + settings + 2 languages first, then a follow-up sweep task for full
  coverage. Date/number formatting via `Intl` with the active locale where it matters.
- 2026-06-12 (Agent-T32): **Mechanism** — homegrown, dependency-free. Typed English
  catalog in `src/lib/i18n.ts` (`const en = {...} as const`; `MessageKey = keyof typeof
  en`, so `tsc` catches key typos across the sweep), `translate`/`interpolate`
  (`{name}`-style params) and `translatePlural` (CLDR categories via
  `Intl.PluralRules`, so Polish few/many work) as pure unit-tested fns; live state in
  `src/store/i18n.ts` (`useI18n` + `t`/`tp` imperative and `useT`/`useTp`/
  `useIntlLocale` hooks). **Switching applies live** — components subscribe to the
  store's `strings` via `useT()`, so a locale change re-renders everything, no reload.
  Missing keys fall back to the English catalog, never the raw key.
- 2026-06-12: **Packs** — `{ name, code, strings }` as `<bcp47>.json`. Bundled en/de/fr/
  pl/es/da in `src/locales/` (static imports); `en.json` is deliberately *thin*
  (`strings: {}`) — English resolves from the TS catalog so the two can't drift; the
  other five are full hand-written translations (~250 keys each).
  `src/lib/locales.test.ts` enforces pack validity, 100% key coverage for the five
  translations, no orphan keys (typo guard, plural-category extras excepted), and
  placeholder preservation. User packs: app-data `…/languages/*.json` via Rust
  `list_languages` + `languages_directory` (`src-tauri/src/commands/languages.rs`,
  mirrors the T11 themes loader; pure `parse_language_pack`/`validate_language_pack`
  with 8 `cargo test`s; bad files skipped). A user pack with a bundled code merges
  per-key on top of the bundled strings (partial fix-up packs work).
- 2026-06-12: **Decisions** — (1) *No `language` plugin category*: packs are
  declarative text-only data files in a dedicated folder, the T11 parallel-loader
  precedent (documented in `docs/i18n.md` + the Rust module header). (2) *Persistence
  in localStorage* (key `locale`), like the theme — synchronous at startup, no flash,
  no migration needed; default = system locale by primary-subtag match
  (`matchLocale`), else English. (3) Selector = new **Language** card
  (`src/components/settings/Language.tsx`) + `settings.nav.language` section in
  SettingsView (list packs, Active/Use, Refresh, Show languages folder). The quick
  window loads user packs in its own init (bundled apply synchronously there too).
- 2026-06-12: **Sweep coverage** — externalized: TitleBar (incl. window controls +
  theme menu), MenuBar, sidebar (Sidebar/ChatsPane/ProjectsPane/SidebarModeSwitch/
  ThreadRow incl. incognito + favorites + delete confirms), ChatView, MessageList
  (compaction divider, tool chips, you/ai gutter, meta), Composer (placeholder, gates,
  palette badge, terminal confirm flow, attach/compact/canvas/stop/send), Canvas,
  ModelChooser, QuickInput (placeholder, destination chips, screenshot), SearchOverlay
  (incl. pluralized match counts), UsageView (summary/heatmap/table), ProjectView,
  ConfirmDialog defaults, all settings cards (API keys, Default Model, Models, Memory,
  Shortcut, Close-to-tray, Appearance: title bar/themes/colors/typography/chat
  style/chat list, MCP, Skills, Plugins, Language), store-created thread titles
  (`deriveTitle` fallback/Image/Untitled via `t`). `formatThreadDate`/`relativeTime`
  now take locale + label templates (pure, parameterized; callers pass
  `useIntlLocale()` + `timeLabels()` — `intlLocale` prefers the *system* regional
  variant when its primary subtag matches the active pack).
  **Not translated (boundary, documented in docs/i18n.md):** chat/model content,
  provider + font proper names, the Rust-built native menu/tray labels (would need
  strings pushed over IPC at menu build), the ErrorBoundary crash screen
  (developer-facing), slash-command palette descriptions (incl. plugin-contributed
  ones), `formatDuration` ("4.2s"), and backend-surfaced error strings
  (`friendlyError`).
- 2026-06-12: **Verified** — `npm run build`, `npm run lint`, `npm test` (307 passed,
  incl. 30 new i18n/locales/store tests), `cargo build`, `cargo clippy`,
  `cargo fmt --check`, `cargo test` (54 passed) all green. Note: `npm run
  format:check` has pre-existing failures from other in-flight work (e.g.
  `lib/mcp.ts`, `ErrorBoundary.tsx`, `UsageView.tsx` were unformatted at HEAD);
  all files this task created or touched are Prettier-clean.
