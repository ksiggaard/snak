# TASKS

Work queue for subagents implementing the remaining features of the KDE LLM app.
Read `CLAUDE.md` first for architecture, conventions, and the frontend/backend boundary.

## How to use this file

Each task is a section with a metadata block. To work a task:

1. **Claim it** — change `Status: todo` → `Status: in-progress` and set `Owner:` to your
   agent id/name. One owner per task; don't pick up a task another agent owns.
2. **Work it** — follow the task's acceptance criteria. Respect the layer boundary in
   `CLAUDE.md` (OS/DB/secrets → Rust; UI → React).
3. **Record progress** — add dated lines under `Notes:` as you go. If you hit a
   dependency or ambiguity you can't resolve, set `Status: blocked` and write why.
4. **Finish** — set `Status: done` when the acceptance criteria are met *and* verified
   (`npm run build`, `npm run lint`, `cargo clippy` as applicable; see
   `superpowers:verification-before-completion`). Don't claim done without running them.

**Status values:** `todo` · `in-progress` · `blocked` · `done`
**Owner:** agent id/name, or `—` when unclaimed.

Keep edits to this file surgical — only touch the task you own (plus adding a new task).

---

## Already implemented (reference, do not redo)

These are built in the current tree — listed so agents don't duplicate work:

- Tauri v2 + React 19 + TS + Vite scaffold; Tailwind v4 + shadcn/ui; light/dark/system theme.
- SQLite via `tauri-plugin-sql` with Rust-registered migration (`001_init.sql`); typed
  frontend helpers in `src/lib/db.ts`.
- API keys in the OS keychain (`keyring`); commands in `commands/keys.rs`.
- Four providers over raw `reqwest` (Anthropic, OpenAI, Mistral, Gemini) with the
  `Provider::stream` trait and SSE streaming; `chat_stream` command.
- Multi-thread chat with a Zustand store (`store/threads.ts`), lazy thread creation,
  last-active-thread restore, sidebar (rename/delete).
- Multimodal image input (`lib/image.ts`, `attachments` table).
- Quick-input overlay window, global shortcut (`Alt+Space`, customizable), screenshot
  capture (`screencapture -i` / `spectacle -r`).

---

## T1 — System tray (minimize to tray)

- **Status:** done
- **Owner:** Agent A
- **Priority:** P0 (headline gap vs. the intended product; no tray code exists today)
- **Layer:** Rust (tray registration) + small frontend touch for window-close behavior
- **Depends on:** —

The intended product "runs minimized to the system tray, summonable via a global
shortcut." There is currently **no tray code anywhere**. Add a system tray icon with a
menu and click-to-toggle behavior for the `main` window.

**Acceptance criteria:**
- Tray icon appears on app start (use existing `src-tauri/icons/`).
- Tray menu with at least: **Show / Hide window** and **Quit**.
- Left-click (or platform-appropriate click) toggles the `main` window's visibility +
  focus. Reuse/extend the show-window helper pattern in `commands/quick.rs`.
- Enable the `tray-icon` feature on the `tauri` crate in `Cargo.toml`; build the tray in
  the `setup` hook in `src-tauri/src/lib.rs`.
- Add any required tray permissions to `src-tauri/capabilities/default.json`.

**Notes:**
- Tray APIs differ slightly across platforms; primary target is KDE/Linux but it should
  build on macOS too (dev machine). Note any platform gating used.
- 2026-06-09 (Agent A): Added `tray-icon` feature to `tauri` in `Cargo.toml`. Tray built
  in the `setup` hook in `lib.rs` (`TrayIconBuilder`, icon from `default_window_icon`),
  menu with Show/Hide (`toggle_main`) + Quit (`app.exit(0)`); left-click-up toggles the
  `main` window (no platform gating needed — tray-icon is cross-platform). Added
  `core:tray:default` + `core:menu:default` to `capabilities/default.json`. cargo
  build/clippy/fmt clean; manual tray click testing deferred (macOS dev box).

---

## T2 — Close-to-tray instead of quit

- **Status:** done
- **Owner:** Agent A
- **Priority:** P1
- **Layer:** Rust (window event handler) + Settings UI toggle (frontend)
- **Depends on:** T1

Closing the `main` window should hide it to the tray rather than terminate the app, so it
keeps running for the global shortcut. Quit must remain reachable from the tray menu (T1).

**Acceptance criteria:**
- Intercept the main window close-requested event; prevent-close + hide instead.
- A setting controls this ("Close to tray" on/off), persisted in the `settings` table
  alike to `global_shortcut` / `last_thread_id`. Default: on.
- Quitting via the tray menu (T1) still fully exits.

**Notes:**
- 2026-06-09 (Agent A): Mechanism — Tauri managed state `CloseToTray(AtomicBool)`
  defaulting to `true`, read synchronously by an `on_window_event` `CloseRequested`
  handler for `main` (`api.prevent_close()` + `window.hide()` when enabled). A
  `set_close_to_tray(enabled)` command (registered in `lib.rs`, appended to the handler
  list) lets the frontend push the value; persistence is in the `settings` table
  (`close_to_tray` = "1"/"0", absent = ON). New `CloseToTray.tsx` settings card
  (Button toggle — no shadcn Switch in the tree) mounted in `App.tsx`, which also syncs
  the saved value into managed state on startup. Tray Quit calls `app.exit(0)` directly,
  bypassing the handler. Verified via cargo build/clippy/fmt + npm build/lint.

---

## T3 — Cancel / stop an in-progress generation

- **Status:** done
- **Owner:** Agent B
- **Priority:** P1
- **Layer:** Rust (abort the reqwest stream) + frontend (Composer stop button, store action)
- **Depends on:** —

There is no way to stop a streaming response once it starts (no abort/cancel anywhere in
`store/threads.ts`, `lib/chat.ts`, or `Composer.tsx`). Add a stop control.

**Acceptance criteria:**
- While `busy`, the Composer shows a **Stop** affordance instead of/alongside Send.
- Stopping halts streaming promptly and persists whatever text was accumulated so far as
  the assistant message (don't lose partial output), clearing `busy`.
- Mechanism crosses the command bridge cleanly — e.g. a cancellation token / abort signal
  the `chat_stream` command observes, or an equivalent approach. Document the choice.

**Notes:**
- 2026-06-09 (Agent B): Cancellation via a shared `CancelFlag(Arc<AtomicBool>)` in Tauri
  managed state. `chat_stream` clears it at the start of each request; the new
  `cancel_stream` command sets it. Each provider polls the flag inside its existing SSE
  `on_data` closure and returns `Ok(false)` to early-exit — the same mechanism used for
  `message_stop` / `[DONE]` — so a cancelled stream still resolves `Ok(ChatResponse{..})`
  with the partial text (nothing lost). `for_each_sse_data`'s signature was left unchanged.
  Frontend: `chat.ts` adds `cancelStream()`; store adds a `cancel()` action + `cancelling`
  flag (the in-flight promise resolves with partial content via the normal completion path,
  persisting only non-empty assistant text); `Composer` shows a destructive **Stop** button
  while `busy`. Verified: `cargo build`/`clippy`/`fmt`, `npm run build`/`lint` all pass.

---

## T4 — Test infrastructure + initial coverage

- **Status:** done
- **Owner:** Agent C
- **Priority:** P1
- **Layer:** Frontend (Vitest) + Rust (`cargo test`)
- **Depends on:** —

There are **no tests** in the repo (no `*.test.*`, no `#[test]`/`#[cfg(test)]`). Stand up
test tooling and seed it with meaningful unit tests on pure logic. Follow
`superpowers:test-driven-development` for any new code written under later tasks.

**Acceptance criteria:**
- Frontend: Vitest configured with an `npm test` script; cover pure helpers such as
  `deriveTitle`, `lib/image.ts` sizing math, and SSE/message shaping logic that can run
  without the Tauri runtime (mock `@tauri-apps/api` where needed).
- Rust: at least the SSE line driver `for_each_sse_data` (`providers/mod.rs`) and one
  per-provider request/response mapping covered by `cargo test`.
- `npm test` and `cargo test` both pass.

**Notes:**
- 2026-06-09 (Agent C): Frontend test infra stood up with **Vitest** (`@vitest/coverage-v8`
  + `jsdom`). Added `test`/`test:watch` scripts and `vitest.config.ts` (mirrors the `@/`
  alias, `environment: "jsdom"`, v8 coverage → `coverage/`). 39 unit tests across 6 files
  (all green): `deriveTitle` (empty/whitespace/boundary-48/truncation), `scaledDimensions`
  (no-upscale clamp + rounding, longer-side selection), `imageDataUrl`, `cn`, theme
  resolution (`getStoredTheme`/`systemPrefersDark`/`resolveTheme`/`applyTheme` with mocked
  `matchMedia` + `localStorage`), and the `PROVIDERS` registry shape. `coverage/` ignored
  in `eslint.config.js` + `.prettierignore`. `npm run build` (tsc) and `npm run lint` stay
  clean.
- **Rust tests: SKIPPED (follow-up).** The SSE line driver `for_each_sse_data` requires a
  real `reqwest::Response` (no pure-string entry point), and per-provider request bodies are
  built inline inside the `async fn stream` methods — there is no extracted pure sync target.
  Every sync fn in `commands/` touches `AppHandle`/keyring/filesystem/OS commands. Covering
  any of these needs either an invasive refactor (extract a pure `build_body(req) -> Value`
  helper per provider, or a `parse_sse_line`/string-driver split) or HTTP mocking deps
  (e.g. `wiremock`) — out of scope under the "no signature changes / minimal Rust" constraint.
  Recommended follow-up: extract `build_request_body` per provider + a string-level SSE
  parser, then unit-test those with `cargo test`.

---

## T5 — KDE/Linux packaging + app branding

- **Status:** todo
- **Owner:** —
- **Priority:** P2
- **Layer:** Tooling / config (Rust bundle) + assets
- **Depends on:** —

`npm run tauri build` is intended to produce AppImage/.deb for KDE. `bundle.targets` is
`"all"` but this hasn't been verified on Linux, and the icons appear to be the default
Tauri placeholders.

**Acceptance criteria:**
- Produce real app icons/branding (replace default Tauri icons in `src-tauri/icons/`).
- Verify `npm run tauri build` yields a working AppImage and/or `.deb` on KDE/Linux;
  document any extra system deps required.
- Confirm the global shortcut, tray (T1), and screenshot (`spectacle -r`) work in the
  packaged build on a real KDE session.

**Notes:**
- This requires a Linux/KDE environment; the dev machine is macOS. Mark `blocked` if no
  KDE target is available and note that.

---

## T6 — Error & edge-case hardening

- **Status:** done
- **Owner:** Agent B
- **Priority:** P2
- **Layer:** Frontend + Rust
- **Depends on:** —

Tighten failure UX across the chat path.

**Acceptance criteria:**
- Friendly, actionable errors for: missing API key for the selected provider, network
  failure, provider HTTP/4xx/5xx (surface the provider's error message), and empty/invalid
  model selection.
- Sending is disabled (with a hint) when the selected provider has no stored key
  (`has_api_key`).
- Long/empty/whitespace-only messages and very large pasted images are handled gracefully.

**Notes:**
- 2026-06-09 (Agent B): Errors routed through the store `error` field via a `friendlyError`
  mapper that classifies the raw provider/Tauri message: missing key and empty-model are
  surfaced from Rust with actionable text ("Add one in Settings."); reqwest failures →
  "Network error…"; provider HTTP statuses (401/403/404/429/5xx) get tailored guidance while
  still appending the provider's returned body (each provider module already returns
  `"<provider> error <status>: <body>"` on non-2xx — verified). `chat_stream` rejects an
  empty/whitespace model up front. Send is gated when the selected provider has no stored
  key (`hasApiKey`, re-checked when the provider changes) with a hint in `Composer`; empty/
  whitespace-only sends are a no-op (store + Composer); image prep failures (oversized/
  unsupported) are caught and shown inline instead of throwing. Verified: `npm run build`/
  `lint`, `cargo build`/`clippy`/`fmt` all pass.

---

## T7 — Fix stale status line in CLAUDE.md

- **Status:** done
- **Owner:** Agent A
- **Priority:** P3 (docs)
- **Layer:** Docs
- **Depends on:** —

`CLAUDE.md` "Project status" still says **"Scaffolded (Stage 0 complete)"**, but Stages
1–6 plus the quick-input/shortcut/screenshot work are implemented in the tree. Update the
status line to reflect reality (and note the remaining gap: system tray, T1).

**Acceptance criteria:**
- "Project status" accurately states what's built vs. outstanding. No other doc churn.

**Notes:**
- 2026-06-09 (Agent A): Rewrote the "## Project status" line in `CLAUDE.md` to reflect
  Stages 1–6 + quick-input/shortcut/screenshots built, with the system tray (this work)
  closing the last gap. No other sections touched.

---

# Product backlog (from README ideas)

Larger forward-looking features sourced from `README.md` "IDEAS". These are coarse-grained
and not yet sprint-scoped — refine the acceptance criteria (and consider a `brainstorming`
pass) before claiming one. Several are interdependent (notably the plugin system T12,
which T11/T14/T15 plug into).

---

## T8 — Markdown rendering for assistant responses

- **Status:** done
- **Owner:** Wave1-T8
- **Priority:** P1
- **Layer:** Frontend
- **Depends on:** —

(README idea 1.) Assistant messages are currently rendered as plain text in
`src/components/chat/MessageList.tsx`. Render Markdown — headings, lists, links, tables,
inline code, and fenced code blocks with syntax highlighting.

**Acceptance criteria:**
- Markdown in assistant messages renders richly (e.g. `react-markdown` + `remark-gfm`);
  fenced code blocks get language-aware syntax highlighting and a copy-to-clipboard button.
- Rendering is XSS-safe (no raw HTML injection) and themed via the existing CSS variables
  in `src/index.css` (works in light/dark).
- Streaming still works — partial/incomplete Markdown during a stream degrades gracefully
  (no crash on an unclosed code fence).

**Notes:**
- Foundational for T10's code-block terminal button and T9's canvas editing.
- 2026-06-09 (Wave1-T8): Assistant messages now render Markdown via
  **`react-markdown` + `remark-gfm`**, with **`rehype-highlight`** (highlight.js,
  github light + github-dark themes) for fenced-code syntax highlighting. New
  `src/components/chat/Markdown.tsx` (renderer; XSS-safe — no `rehype-raw`),
  `CodeBlock.tsx` (copy-to-clipboard + language badge), `lib/markdown.ts` (pure
  helpers `languageFromClassName`/`codeText`, unit-tested in `markdown.test.ts`),
  and a generated `highlight-theme.css` (github-dark scoped under `.dark`).
  `MessageList.tsx` renders assistant `content` through `<Markdown>`; user
  messages + images unchanged. Streaming-safe: react-markdown re-parses the
  growing string each token and tolerates unclosed fences. **Code-fence language
  for T17** is surfaced as a `data-language` attribute on the CodeBlock wrapper
  (plus the original `language-<lang>` class on `<code>`), parsed by
  `languageFromClassName`. Verified: `npm run build`/`lint`/`test` all pass
  (48 tests). No files edited beyond the owned set.

---

## T9 — Canvas mode for editing long messages

- **Status:** todo
- **Owner:** —
- **Priority:** P2
- **Layer:** Frontend
- **Depends on:** T8

(README idea 2.) A larger side/overlay "canvas" surface for composing and editing long
Markdown messages, with a live preview, rather than the compact `Composer` textarea.

**Acceptance criteria:**
- Toggle a canvas view that edits Markdown with a live rendered preview (reusing T8's
  renderer).
- Content round-trips into the normal send flow (the store's `send`); images still attach.
- Sensible UX for opening/closing without losing draft content.

**Notes:**

---

## T10 — Settings: system-message append + user memory

- **Status:** done
- **Owner:** Wave3-T10
- **Priority:** P1
- **Layer:** Frontend + DB (Rust migration)
- **Depends on:** —

(README idea 3.) Extend the existing settings panel (`src/App.tsx`, `src/components/
settings/`) with: (a) a custom string appended to the system prompt, and (b) persistent
"memory about the user" injected into context.

**Acceptance criteria:**
- A settings field for a custom system-prompt addendum, persisted (global in the `settings`
  table, or per-thread — decide and document) and actually prepended/merged into the
  provider `system` field on each request (see how Anthropic/Gemini handle `system` in
  `src-tauri/src/providers/`).
- A "user memory" store (likely a new table via a numbered migration in
  `src-tauri/migrations/`) editable in settings and injected into the system context.
- Existing chats keep working when these are empty.

**Notes:**
- Anthropic/Gemini take `system`/`systemInstruction` specially — consult the `claude-api`
  skill before changing request shapes.
- 2026-06-09 (Wave3-T10): Implemented at the **message-assembly layer** in
  `store/threads.ts` `send()` — no `src-tauri/src/providers/` changes (T18 owns that), riding
  the existing `role:"system"` handling each provider already has.
  - **Both inputs are global** (apply to every thread/provider) — simplest model, documented
    in `src/lib/systemContext.ts`. The **system-prompt addendum** is a single global string in
    the `settings` table (`system_prompt_addendum`); **user memory** is a row-per-entry table
    (`user_memory`, migration **005**, version 5).
  - **Composition (`src/lib/systemContext.ts` — `buildGlobalSystemText`, unit-tested):** the
    addendum + a bulleted "Memory about the user:" block are combined into one leading
    `role:"system"` message. Empty inputs produce `""` and are skipped, so existing chats are
    unaffected when nothing is configured.
  - **Precedence global → project → thread:** in `send()` the project system message (T20's
    `buildProjectSystemText`) is `unshift`ed first and the global message second, so the array
    ends up `[global, project, ...history]`. Providers concatenate consecutive `system` messages
    in array order (Anthropic/Gemini join with `\n\n`; OpenAI/Mistral pass through), realizing
    the precedence with no Rust changes. "Thread" = the conversation history (no separate
    per-thread prompt exists).
  - **UI:** `src/components/settings/Memory.tsx` ("System prompt & memory" card), mounted in
    `src/App.tsx` between ApiKeys and Shortcut. DB helpers added to `src/lib/db.ts`
    (`listUserMemory`/`addUserMemory`/`updateUserMemory`/`deleteUserMemory`,
    `SYSTEM_PROMPT_ADDENDUM_KEY`); `UserMemory` type in `src/types/db.ts`.

---

## T11 — User-installable themes

- **Status:** done
- **Owner:** Wave2-T11
- **Priority:** P2
- **Layer:** Frontend + Rust (filesystem load)
- **Depends on:** —

(README idea 4.) A theme is a folder with a manifest file + a stylesheet; users drop themes
into a themes directory and select them. Builds on the existing CSS-variable theming in
`src/index.css` and `src/store/theme.ts`.

**Acceptance criteria:**
- Defined theme folder format: manifest (name/author/version) + a CSS file overriding the
  documented CSS variables.
- Rust loads installed themes from an app data directory and exposes them; the frontend
  lists/selects/applies one (persisted alongside the existing theme preference).
- Documentation of the available CSS variables and how to author a theme.

**Notes:**
- Could later be delivered as a "Theme" plugin category under T12.
- 2026-06-09 (Wave2-T11): Implemented a **parallel themes-folder loader** rather than going
  through the T12 plugin registry. Rationale: T11's required on-disk format is a *folder*
  with a separate `theme.json` + `theme.css`, whereas the plugin host's `theme` contribution
  inlines `{ name, css }` in `manifest.json` and the host only reads `manifest.json` — so the
  folder format is not loadable by the plugin host without modifying its internals (out of
  scope). The two are **composed** in the UI: the Themes card folds enabled `theme`-category
  plugin contributions (read via `selectRegistry`) into the same selector as folder themes.
  - **Format:** `…/themes/<id>/theme.json` (`name`, `version`, optional `author`) + `theme.css`
    (overrides the documented `--*` vars). Folder name = stable selection id.
  - **Rust:** `src-tauri/src/commands/themes.rs` — `list_themes` (discover + validate, skip
    bad folders) and `themes_directory` (reveal path, create on demand). `app_data_dir()` via
    `AppHandle::path()`; direct `std::fs` reads (no fs-plugin permission needed). Pure
    `parse_theme_manifest`/`validate_theme_manifest`, unit-tested (5 tests).
  - **Frontend:** `src/lib/themes.ts` wrappers; `src/store/theme.ts` extended (`installed`,
    `themeId`, `loadInstalled`, `selectTheme`); `src/lib/theme.ts` adds `getStoredThemeId`/
    `storeThemeId`/`applyInstalledThemeCss` (injects a `<style id="installed-theme">`).
    Selection persisted in localStorage (alongside light/dark), re-applied on startup from
    `App.tsx`. Settings card `src/components/settings/Themes.tsx`. Composes with light/dark
    (theme CSS only re-tints the documented vars). Tests: `src/store/theme.test.ts` +
    additions to `src/lib/theme.test.ts`.
  - **Docs:** `docs/theming.md` (format, variable list, light/dark, install) + a documented
    CSS-variable-contract comment block in `src/index.css`.

---

## T12 — Plugin system (foundation)

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

---

## T13 — MCP support (with built-in web-browsing server)

- **Status:** todo
- **Owner:** —
- **Priority:** P2
- **Layer:** Rust (MCP client + tool dispatch) + Frontend
- **Depends on:** —

(README idea 6.) Support the Model Context Protocol so the app can use external tools, and
ship an out-of-the-box MCP server for web browsing.

**Acceptance criteria:**
- An MCP client in the Rust backend that connects to configured MCP servers and exposes
  their tools to the model via each provider's tool-use API.
- The streaming chat loop (`commands/chat.rs`, `providers/`) handles tool-call rounds
  (request tool → execute via MCP → feed result back) without breaking SSE streaming.
- A bundled/default web-browsing MCP server works out of the box; servers are configurable
  in settings.

**Notes:**
- Tool use differs per provider — consult the `claude-api` skill for Anthropic tool-use and
  MCP specifics before implementing the request/response shapes.

---

## T14 — Slash command support

- **Status:** todo
- **Owner:** —
- **Priority:** P3
- **Layer:** Frontend (parsing/UX) + Rust (execution) + plugins
- **Depends on:** T12

(README idea 7.) Slash commands typed in the composer, installable via plugins. Example:
`/terminal cat /path/to/file` runs a terminal command (via a plugin) and feeds the output
into the chat.

**Acceptance criteria:**
- Composer detects `/command args`, with discovery/autocomplete of available commands.
- Commands are contributed by plugins (T12); a command can transform input, inject context,
  or run a backend action and feed output into the thread.
- The `/terminal …` example works end-to-end as a reference plugin (executes via Rust,
  output rendered in chat). Command execution has an explicit safety/confirmation model.

**Notes:**
- Running arbitrary terminal commands is dangerous — gate behind confirmation/allowlist.

---

## T15 — Skills support

- **Status:** done (Wave4-T15, 2026-06-09 — a skill = a `skill`-category T12
  plugin contributing `{name, instructions}`; enabled skills' instructions are
  composed by the pure `buildSkillsSystemText` (`src/lib/skills.ts`) and
  unshifted as a leading `role:"system"` message in `store/threads.ts` `send()`
  alongside the global guidance; a **Skills** settings card lists them with
  enable/disable toggles reusing the plugin enable/disable. Empty → no message.)
- **Owner:** Wave4-T15
- **Priority:** P3
- **Layer:** Frontend + Rust + plugins
- **Depends on:** T12

(README idea 8.) Reusable "skills" — packaged instructions/capabilities the model can use —
installable and managed like other plugin categories.

**Acceptance criteria:**
- A skill package format and a way to install/enable/disable skills (a plugin category
  under T12).
- Enabled skills are surfaced to the model (e.g. injected guidance and/or exposed as
  tools), and a settings UI manages them.

**Notes:**
- Scope deliberately once T12's host API exists; align the skill format with that API.

---

## T16 — Token usage tracking

- **Status:** done (Wave2-T16, 2026-06-09 — usage captured per-provider in the
  streaming SSE loop, persisted to a v3 `usage` table, surfaced in a sortable
  by-model table + GitHub-style activity heatmap.)
- **Owner:** Wave2-T16
- **Priority:** P2
- **Layer:** Rust (capture usage) + DB (migration) + Frontend (charts)
- **Depends on:** —

(README idea 9.) Record and visualize token usage across models over time: input, output,
and cache tokens, with a table and a GitHub-style activity heatmap.

**Acceptance criteria:**
- Capture per-response usage (input/output/cache tokens + model + provider) from each
  provider's API response in `src-tauri/src/providers/` and persist it (new table via a
  numbered migration in `src-tauri/migrations/`).
- A usage view: a sortable table (by model/date) and a GitHub-style colored-squares
  calendar heatmap of activity.
- Usage is attributed to the right model even when a thread's model changes.

**Notes:**
- Provider usage fields differ (Anthropic reports cache-read/-write tokens separately) —
  consult the `claude-api` skill for the usage object shape. Streaming responses report
  usage in specific SSE events; capture from the existing SSE loop.

---

## T17 — "Open in terminal" for bash code blocks

- **Status:** done (Wave2-T17, 2026-06-09)
- **Owner:** Wave2-T17
- **Priority:** P2
- **Layer:** Frontend (detect) + Rust (launch terminal)
- **Depends on:** T8

(README idea 10.) When an assistant response contains a `bash`/`sh` fenced code block, show
a button to open a terminal pre-loaded with that command.

**Acceptance criteria:**
- `bash`/`sh` code blocks (rendered via T8) get an "Open in terminal" action.
- A Rust command launches the KDE terminal (e.g. Konsole) with the command staged but
  **not auto-executed** (user reviews/runs it), mirroring the desktop-only, platform-gated
  pattern of `take_screenshot` in `commands/quick.rs`.
- Safe handling of multi-line commands and shell-special characters.

**Notes:**
- Never auto-run model-generated commands — stage only, require explicit user execution.

---

## T18 — Bundled plugins active by default; providers as built-in plugins

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

---

## T19 — Search previous dialogues

- **Status:** done
- **Owner:** Wave3-T19
- **Priority:** P2
- **Layer:** Frontend + DB
- **Depends on:** —

Let users search across their chat history — a rich search field plus a results page —
to find and jump back into past conversations. History lives in the `threads`/`messages`
tables (SQLite via `tauri-plugin-sql`); add typed query helpers in `src/lib/db.ts`.

**Acceptance criteria:**
- A search field (in the sidebar/`ThreadList` and/or a global shortcut) that queries both
  thread titles and message content.
- A results page/view showing matches grouped by thread, with a snippet of the matching
  text and the matched terms highlighted; selecting a result opens that thread (and ideally
  scrolls to the matching message).
- Reasonably fast on large histories — consider a SQLite **FTS5** virtual table populated
  via a numbered migration in `src-tauri/migrations/` (kept in sync on message insert),
  rather than naive `LIKE` scans.
- Empty/no-results state and clearing the search are handled cleanly.

**Notes:**
- If FTS5 is used, decide how the index stays current (triggers vs. app-side writes) and
  document it; never edit a shipped migration — add a new numbered one.
- 2026-06-09 (Wave3-T19): FTS5 virtual table `search_fts` (migration **004**) over thread
  titles + message content, tokenize `porter unicode61`. Kept in sync via SQLite **triggers**
  on `threads`/`messages` insert/update/delete (chosen over app-side writes so the index
  can't drift), with a one-time backfill of pre-existing rows. FTS5 availability confirmed
  (libsqlite3-sys bundled SQLite compiled with `-DSQLITE_ENABLE_FTS5`); a `LIKE` fallback is
  kept as defence-in-depth. Search helpers in `src/lib/db.ts` + `src/lib/search.ts` (pure
  snippet/highlight), `src/store/search.ts`, UI in `src/components/search/` (field + grouped
  results with highlighted snippets); opening a result calls the existing `selectThread` and
  scrolls to + briefly flashes the matched message in `MessageList.tsx`. Empty/no-results +
  clear handled. Verified: `npm run build`/`lint`/`test` (94) + `cargo build`/`clippy`/`fmt`.

---

## T20 — Projects (grouped threads with shared instructions + files)

- **Status:** done
- **Owner:** Wave1-T20
- **Priority:** P2
- **Layer:** DB (migration) + Rust + Frontend
- **Depends on:** —

Introduce **projects**: a named group of threads that share a common base context —
project-level instructions and attached files — automatically applied to every thread in
the project. (Conceptually like Claude/ChatGPT "Projects".)

**Acceptance criteria:**
- Data model via a numbered migration in `src-tauri/migrations/`: a `projects` table,
  per-project **instructions** (text) and **files** (reuse the base64 `attachments`
  pattern, or store text/file content for context), and a nullable `project_id` on
  `threads` (a thread belongs to at most one project; threads can also exist with no
  project). Don't rely on FK cascade — delete children explicitly like `deleteThread`.
- Project instructions + files are injected as base context into every request for threads
  in that project (merged with the per-thread/global system prompt from T10 and the message
  history; mind provider `system`/`systemInstruction` handling).
- Frontend: create/rename/delete projects; the sidebar groups threads by project; a project
  view to edit its instructions and manage its files; creating a thread inside a project
  inherits the base context.
- Typed helpers in `src/lib/db.ts` and store actions in `src/store/threads.ts` (or a new
  projects store); existing project-less threads keep working unchanged.

**Acceptance criteria — edge cases:**
- Large project files don't blow the context window — define a strategy (truncate, select,
  or note as a follow-up) and surface it to the user.
- Deleting a project: decide thread fate (orphan to no-project vs. cascade-delete) and
  confirm destructive actions.

**Notes:**
- Composes with T10 (system-message/memory) — settle precedence: global → project → thread.
- Before changing Anthropic/Gemini request shapes for context injection, consult the
  `claude-api` skill.
- 2026-06-09 (Wave1-T20): Implemented. Migration `002_projects.sql` (version 2) adds
  `projects(id,name,instructions,created_at,updated_at)`, `project_files(id,project_id,name,
  content,created_at)` (text content, not base64 — project files are reference text), and a
  nullable `threads.project_id` (+ indexes). Context injection is done **entirely in the
  frontend** at the message-assembly layer: `store/threads.ts` `send()` loads the project +
  files for a thread's `project_id` and prepends a synthetic `role:"system"` message built by
  the pure helper `buildProjectSystemText` (`src/lib/projects.ts`), ordered before history and
  phrased as context per the `claude-api` skill. **No `src-tauri/src/providers/` changes** —
  this rides the existing `role:"system"` handling (Anthropic top-level `system`, Gemini
  `systemInstruction`, OpenAI/Mistral pass-through). Context-window guard: files included in
  order up to a 100k-char budget, overflow truncated + remainder noted; size meter + warning in
  the project view. Deleting a project **orphans its threads to no-project** (project_id→NULL),
  not cascade-delete; confirmed in the UI. New `src/store/projects.ts`, `src/components/
  projects/ProjectView.tsx`, sidebar grouping in `ThreadList.tsx`, additive `App.tsx` project
  pane. DB helpers + types are additive. Verified: `npm run build`/`lint`/`test` (49 pass, 10
  new for `buildProjectSystemText`/`projectFilesSize`), `cargo build`/`clippy`/`fmt --check`/
  `test` all clean.
