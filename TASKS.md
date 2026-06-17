# TASKS

Work queue for subagents implementing the remaining features of the snak app.
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

- **Status:** done
- **Owner:** Claude (orchestrator) — Linux slice
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
- 2026-06-10 (WS-A): **macOS slice done** alongside T26 — `src-tauri/Info.plist` (new) carries
  `NSScreenCaptureUsageDescription`, wired via `bundle.macOS.infoPlist` in `tauri.conf.json`,
  so packaged builds can be granted Screen Recording. Confirmed `src-tauri/icons/` are real
  `snak` branding (not Tauri placeholders) and `productName`/`com.snak.app` are correct.
  **Still BLOCKED:** producing/verifying the AppImage + `.deb` and confirming the tray, global
  shortcut, and `spectacle -r` on a real KDE session — needs a Linux/KDE machine (dev box is
  macOS). Pick this up on a KDE target.
- 2026-06-12 (Claude, orchestrator): **Linux packaging slice done on a real KDE box (CachyOS/
  Arch).** `npm run tauri build` produced `snak_0.1.0_amd64.deb` (8.3 MB) and
  `snak-0.1.0-1.x86_64.rpm` cleanly; the AppImage step initially failed with
  `failed to run linuxdeploy` — root cause: linuxdeploy's bundled `strip` (old binutils)
  can't read the `.relr.dyn` (SHT_RELR) ELF sections emitted by modern Arch toolchains.
  Workaround (documented upstream): run with **`NO_STRIP=true npm run tauri build`** —
  produces `snak_0.1.0_amd64.AppImage` (106 MB). No other extra system deps were needed
  (fuse2 was already present; linuxdeploy is auto-downloaded to `~/.cache/tauri`).
  **2026-06-12 (later):** Kasper confirmed the packaged AppImage in the live KDE session:
  tray icon (sharp after switching the embedded tray asset from `icons/32x32.png` to
  `icons/128x128.png` in `lib.rs` — KDE panels render above 32px), global shortcut
  (Alt+Space), and `spectacle -r` screenshot capture all work. All acceptance criteria met.

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

- **Status:** done
- **Owner:** Wave4-T9
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
- 2026-06-09 (Wave4-T9): Implemented as a frontend-only overlay. New
  `src/components/chat/Canvas.tsx` — a full-screen modal (`fixed inset-0`,
  backdrop blur) with a split pane: a monospace Markdown editor on the left and a
  live rendered **preview reusing T8's `<Markdown>`** on the right. Toggled from a
  new expand button (`Maximize2`) in the `Composer` button row.
  - **Draft round-trips with zero copying:** the canvas does NOT own state — the
    draft `text`/`images` stay in `Composer.useState`, and the canvas edits them
    via `onChange`/`onRemoveImage` props. So opening/closing the canvas (Esc or the
    X button) leaves the exact same draft in the compact textarea, and vice-versa;
    typing in either surface is the same state. Send from the canvas calls the
    Composer's existing `send()` (same `onSend` prop → store `send`), which clears
    the draft and closes the canvas; images attached in the composer are sent too
    and previewable/removable in the canvas footer.
  - **UX:** Cmd/Ctrl+Enter sends from the canvas (plain Enter inserts newlines,
    unlike the compact composer's Enter-to-send, since this is a long editor); Esc
    closes keeping the draft; Send is gated on the same `canSend` (provider
    enabled + key present + non-empty) as the composer.
  - **Owned-set only:** edited `Composer.tsx` (deep-edit, owned) + added
    `Canvas.tsx`; **no** `ChatView.tsx`/store/`MessageList`/Rust changes were
    needed — the canvas hosts entirely inside the composer. No new pure helper was
    extracted (the change is UI composition over existing state), so no new
    `*.test` file; the existing 108 tests still pass.
  - Verified: `npm run build` (tsc + vite) ✓, `npm run lint` ✓, `npm test`
    (108 pass) ✓.

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

- **Status:** done
- **Owner:** Wave4-T13
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
- 2026-06-09 (Wave4-T13): Done. Rust MCP client at `src-tauri/src/mcp/` (stdio +
  HTTP JSON-RPC transports + in-process built-in web-browse server `fetch_url`),
  tools aggregated + namespaced `<server>__<tool>`. `CompletionRequest.tools` /
  `ChatResponse.tool_calls` added; all four providers map tool schemas + parse
  tool calls from their streams. `chat_stream` runs the server-side tool-call
  loop (max 5 rounds) while preserving SSE text streaming; sends no `tools` when
  the enabled-server list is empty → no-tools path byte-identical. Frontend:
  `src/lib/mcp.ts` (config persisted in `settings.mcp_servers`, read inside
  `chatStream` so `threads.ts` is untouched) + `McpServers` settings card. Design
  doc: `docs/superpowers/specs/2026-06-09-mcp-support-design.md`. Verified:
  cargo build/clippy/fmt/test (41) + npm build/lint/test (114).

---

## T14 — Slash command support

- **Status:** done
- **Owner:** Wave5-T14
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
- 2026-06-09 (Wave5-T14): Done. Pure parsing/resolution in **`src/lib/slashCommands.ts`**
  (`parseSlashInput`/`availableCommands`/`matchCommands`/`resolveCommand` + `BUILTIN_COMMANDS`),
  unit-tested in `slashCommands.test.ts` (22 tests: parse edge cases, plugin folding/dedup,
  match filtering, resolution). The composer (`Composer.tsx`, owned deep-edit) detects a
  leading `/`, shows an **autocomplete palette** (Up/Down/Tab/Enter/Esc) of built-in +
  enabled-plugin commands, and routes a resolved command on send while leaving normal
  (non-slash) sending unchanged (a leading space, `//literal`, or an unresolved `/foo` all
  send as normal text). T9's canvas/expand button integrated additively.
  - **Plugin integration:** plugin commands come from the **T12 host registry**
    (`selectRegistry(usePlugins).slashCommands` → `{ command, description }`) — never plugin
    internals. Per T12's declarative security model, contributions advertise a command but
    ship no executable code, so an unhandled contribution is discoverable but posts an
    explanatory chat note instead of running. Added a built-in `slash-command` plugin
    `src-tauri/src/plugins/builtin/terminal.json` (registered in `plugins/mod.rs`
    `builtin_manifests()`; the builtins-count test updated 4→5 with a category assertion).
  - **`/terminal <cmd>` reference (end-to-end):** built-in `kind: "terminal"`. Running it
    NEVER auto-executes — it opens an in-composer **confirmation gate** showing the exact
    command; only on the user clicking "Stage in terminal" does it call **T17's
    `openInTerminal`** (`src/lib/terminal.ts` → Rust `open_in_terminal`, which *stages* the
    command pre-typed in an OS terminal for the user to review and Enter). A fenced
    confirmation is then fed into the thread. **Safety gate:** model/user shell text is never
    run silently — explicit confirm in-app + a second explicit Enter in the terminal.
  - **`store/threads.ts` touch (additive only):** one new action `postNote(content)`
    (interface decl + impl) that persists a synthetic `assistant` message into the current
    thread (lazy draft-thread creation mirroring `send`), with no provider/stream call — the
    channel slash output uses to feed the thread. **`send()`'s internals are untouched.**
  - Verified: `npm run build` ✓, `npm run lint` ✓, `npm test` (143 pass, +22) ✓;
    `cargo build`/`clippy`/`fmt --check` ✓, `cargo test` (41 pass) ✓.

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

---

## T21 — Responsive layout (adapt the UI from narrow to wide)

- **Status:** done
- **Owner:** WS-C
- **Priority:** P1 (usability across window sizes; the app is meant to run small/quick too)
- **Layer:** React (Tailwind)
- **Depends on:** —

The app chrome assumes a wide window: the sidebar (`src/components/sidebar/ThreadList.tsx`,
fixed `w-64`), the header (`src/App.tsx`), the two-pane Settings (`src/components/settings/
SettingsView.tsx`), and the composer. Make the layout adapt cleanly from narrow to wide so
nothing clips or overflows. (The fixed-size quick-input overlay is out of scope.)

**Acceptance criteria:**
- At narrow widths the sidebar collapses or overlays instead of squeezing the chat column;
  the Settings two-pane stacks (or its section nav collapses to a dropdown/scroller).
- Header controls (title, `ModelPicker`, Usage/Settings buttons, `ThemeToggle`) wrap or
  condense rather than overflowing.
- No horizontal scrollbars or clipped controls between roughly 480px and 1400px wide.
- Prefer Tailwind responsive utilities over JS resize listeners.

**Notes:** Composes with T22 (resizable/toggleable sidebar) and T25 (moving chrome into the sidebar).
- 2026-06-10 (WS-C): Done as part of the coherent sidebar/layout overhaul. `md` (768px)
  is the inline⇄overlay boundary: at >= md the sidebar is an inline `<aside>`; below md it
  renders as a left `Sheet` overlay opened by a hamburger in `main` (`App.tsx`). The
  `SettingsView` two-pane now stacks (`flex-col md:flex-row`) with the section nav as a
  horizontal `overflow-x-auto` strip on narrow / vertical `md:w-44` on wide. `main` is
  `min-w-0` and uses `p-3 md:p-4`; no horizontal scrollbars ~480–1400px. Tailwind utilities
  only (no JS resize listeners). The chat header was removed (T25) so there are no header
  controls left to overflow.

---

## T22 — Resizable sidebar + show/hide toggle

- **Status:** done
- **Owner:** WS-C
- **Priority:** P1 (reclaim space; pairs with T21)
- **Layer:** React
- **Depends on:** —

The sidebar (`ThreadList.tsx`) is a fixed `w-64`. Make it user-resizable by dragging its
edge, and add a button to toggle it hidden/shown.

**Acceptance criteria:**
- A drag handle on the sidebar's right edge resizes its width within a sensible min/max;
  the chosen width persists (localStorage, mirroring the theme preference, or the `settings`
  table).
- A toggle button (header or sidebar) hides/shows the sidebar; the open/closed state persists.
- The chat column reflows to fill the freed space; behaves well with T21 responsive rules.

- 2026-06-10 (WS-C): A custom `SidebarResizeHandle` (pointer events, rAF-coalesced) on the
  aside's right edge resizes within `SIDEBAR_MIN..MAX` (200–480px, default 256 = old `w-64`),
  applied as an inline `style={{ width }}` (Tailwind v4 can't class a runtime px). Width,
  open/closed, and mode are pure-UI prefs in **localStorage** via `src/lib/layout.ts` +
  `src/store/layout.ts` (mirrors `theme.ts`, seeded synchronously to avoid a flash;
  `clampSidebarWidth` + persistence unit-tested in `layout.test.ts`). A collapse toggle in
  `SidebarHeader` hides the inline sidebar; a slim in-flow toggle bar in `main` shows a reopen
  button (desktop, when collapsed) / hamburger (narrow) so the user is never stranded. No
  `react-resizable-panels` dependency. The handle is `hidden md:block` (moot when overlaying).

---

## T23 — Favorite chats (Favorites section in the sidebar)

- **Status:** done
- **Owner:** WS-C
- **Priority:** P2
- **Layer:** React + Rust (migration)
- **Depends on:** —

Let the user favorite a thread and surface a Favorites group at the top of the sidebar.

**Acceptance criteria:**
- A new numbered migration (next version after `006_models.sql`) adds a `favorite` flag to
  `threads` (e.g. `favorite INTEGER NOT NULL DEFAULT 0`); register it in `lib.rs` — never
  edit a shipped migration.
- `Thread` type gains the field; a typed helper in `src/lib/db.ts` and a `store/threads.ts`
  action toggle it.
- `ThreadList` renders a Favorites group above the normal/grouped list, with a star toggle
  per thread.
- Existing threads default to not-favorited; list ordering stays stable.

- 2026-06-10 (WS-C): Migration **007_favorites.sql** (version 7, registered in `lib.rs`) adds
  `threads.favorite INTEGER NOT NULL DEFAULT 0`. `Thread` gains `favorite: number`; `db.ts`
  adds `setThreadFavorite` (does NOT bump `updated_at`, so favoriting doesn't reorder recents);
  `store/threads.ts` adds a `toggleFavorite(id)` action. The Chats pane (`ChatsPane.tsx`, T24)
  renders a **Favorites** group above the flat "All chats" list, with a star toggle per row
  (`ThreadRow.tsx`). Groups are computed from the live thread list (stale-safe on delete).

---

## T24 — Sidebar mode shift: Chats vs Projects

- **Status:** done
- **Owner:** WS-C
- **Priority:** P2
- **Layer:** React
- **Depends on:** T20

Projects (T20) take up too much sidebar space by default. Add a mode switch so the sidebar
shows either Chats or Projects, not both at once.

**Acceptance criteria:**
- A segmented control / tabs at the top of `ThreadList` switches between "Chats" and
  "Projects"; the selected mode persists.
- Chats mode lists threads (including Favorites from T23 if present); Projects mode lists
  projects, and opening one shows that project's threads.
- Default mode is Chats; project-less threads remain reachable.

- 2026-06-10 (WS-C): A `ToggleGroup` mode switch (`SidebarModeSwitch.tsx`) at the top of the
  sidebar flips between **Chats** (`ChatsPane` — favorites + a flat list of ALL threads, so
  project-less ones are always reachable) and **Projects** (`ProjectsPane` — the project list;
  opening one shows its detail view and reveals its threads). Mode persists in localStorage
  (`useLayout.sidebarMode`, default `chats`). The mode-appropriate "New chat"/"New project"
  action sits in the sidebar's action row.

---

## T25 — Move app chrome into the sidebar (reclaim chat vertical space)

- **Status:** done
- **Owner:** WS-C
- **Priority:** P2
- **Layer:** React
- **Depends on:** —

The chat's vertical space is wasted on the app title, model picker, Usage/Settings buttons,
and color-scheme toggle in the header (`src/App.tsx`). Move these into sidebar sections or a
menu (button/dropdown) so the chat area is taller.

**Acceptance criteria:**
- App title, `ThemeToggle`, and the Usage/Settings entry points relocate from the header
  into the sidebar (e.g. a header/footer area of `ThreadList`) or a dropdown menu.
- The `ModelPicker` moves to the sidebar or becomes a compact control near the composer —
  pick one and keep it one click away.
- The chat header is removed or minimized so `MessageList`/`Composer` gain the reclaimed
  height.

**Notes:** Touches `src/App.tsx` (header block), `ModelPicker`, `ThemeToggle`, and the
`SettingsView` entry point. Composes with T21 (responsive) and T22 (sidebar toggle).

- 2026-06-10 (WS-C): The chat `<header>` in `App.tsx` is **removed**. The app title, an
  overflow `DropdownMenu` (Settings, Usage, and a Theme radio group replacing `ThemeToggle`),
  and the collapse toggle now live in `SidebarHeader.tsx`. View routing moved to a small
  `store/view.ts` (`chat | settings | usage`); project/search panes still come from their own
  stores. Per the chosen design, the **ModelPicker moved to a compact control just above the
  composer** (rendered at the top of `Composer.tsx`, height reserved to avoid a null→select
  shift). `ThreadList.tsx` was split into `Sidebar`/`SidebarContent`/`SidebarHeader`/
  `SidebarModeSwitch`/`ChatsPane`/`ProjectsPane`/`ThreadRow` and removed. New shadcn/ui
  components added (against the unified `radix-ui` package): `dropdown-menu`, `tooltip`,
  `sheet`, `toggle-group` (+ `toggle`). Verified: `npm run build`/`lint`/`test` (176) and
  `cargo build`/`clippy`/`fmt`/`test` (41) all pass.

---

## T26 — Bug: screenshot capture fails on macOS ("Could not create image from rect")

- **Status:** done
- **Owner:** WS-A
- **Priority:** P1 (a headline feature is broken)
- **Layer:** Rust (+ permissions/UX)
- **Depends on:** —

Taking a screenshot errors with "Could not create image from rect" on macOS (possibly
elsewhere). The capture path is `take_screenshot` in `src-tauri/src/commands/quick.rs`
(runs `screencapture -i`, returns base64 PNG; temp prefix `snak-shot-…`).

**Acceptance criteria:**
- Reproduce and root-cause it (likely macOS Screen Recording permission, an interactive-
  capture cancel writing no file, or temp-path/rect handling). Use `superpowers:systematic-debugging`.
- An interactive region capture returns a valid image; a user-cancelled capture returns
  `null` cleanly without surfacing an error.
- If the OS denies Screen Recording permission, surface a clear, actionable message telling
  the user to grant it.
- Verify on macOS; note Linux (`spectacle -r`) behavior.

**Notes:**
- 2026-06-10 (WS-A): Root cause confirmed — `capture_interactive()` (macOS) used `.status()`,
  discarding stderr and the exit code; `read_and_encode` then treated the absent/empty output
  file as a clean user cancel (`Ok(None)`), silently masking permission-denied and degenerate-
  rect failures. Fix: rewritten to `.output()` with three-way outcome classification: (1) exit
  success + no file + empty stderr → `Ok(None)` (genuine user cancel, unchanged); (2) non-zero
  exit or absent file with permission-related stderr ("could not create image from rect" /
  "not authorized" / "permission") → `Err(PERMISSION_MSG)` with actionable instructions to
  grant Screen Recording in System Settings; (3) other failure → `Err` surfacing trimmed stderr
  verbatim. Added `-x` flag to silence the shutter sound while the overlay is hidden. Linux
  Spectacle branch left functionally unchanged (its file-or-nothing behavior already maps
  correctly through `read_and_encode`). Frontend `QuickInput.tsx`: wrapped `screenshot()` body
  in try/catch; caught `Err` message surfaced via a new `error` state rendered as a
  `text-destructive` `<p>` above the textarea (dismisses on next attempt or cancel/reset). T5
  macOS slice: added `src-tauri/Info.plist` with `NSScreenCaptureUsageDescription` and
  referenced it via `bundle.macOS.infoPlist` in `tauri.conf.json` so packaged builds declare
  the usage string to macOS. Icons: the `src-tauri/icons/` set is real snak branding (512×512
  teal lips/"Snak" logo), not default Tauri placeholders. Bundle identifier `com.snak.app` and
  `productName "snak"` both look correct. Verified: `cargo build`/`clippy`/`fmt` clean;
  `npm run build`/`lint` clean.

---

## T27 — Token-spend activity graph: month labels, responsive, styled hover

- **Status:** done
- **Owner:** WS-B
- **Priority:** P3
- **Layer:** React
- **Depends on:** T16
- **Notes (2026-06-10):** Added `monthLabelColumns` pure helper (TDD, unit-tested); responsive `ActivityHeatmap` via `ResizeObserver` callback ref that trims visible columns to fit container width; replaced `title` attribute with `DayTooltip` (fixed-position, popover/design-token styled) showing date + input/output/cache breakdown. Extended `DailyUsage` and `HeatmapCell` types with token breakdown fields.

The GitHub-style activity graph in the usage view (`src/components/usage/UsageView.tsx`,
from T16) needs month indicators, should be responsive to width, and its per-day hover
popup should be styled.

**Acceptance criteria:**
- Month labels render above the columns, aligned to week boundaries.
- The graph adapts to the available width (column count/size) without overflowing; works
  with T21.
- Hovering a day shows a styled tooltip (date + input/output/cache token counts) using the
  app's popover tokens, not a raw `title` attribute.

**Notes:** Builds on the existing usage view and the usage data layer (`src/lib/usage.ts`)
from T16.

---

# Backlog (from IDEAS.md, 2026-06-12)

Sourced from `IDEAS.md`. Coarse-grained — refine acceptance criteria (and consider a
design pass) before claiming one.

---

## T28 — Compact a chat (context summarization)

- **Status:** done
- **Owner:** Agent-T28
- **Priority:** P2
- **Layer:** Frontend (store + Composer) + possibly DB (migration)
- **Depends on:** —

(IDEAS 1.) Like Claude Code's `/compact`: condense a long conversation into a summary so
the thread can continue without resending the full history each turn. Triggered from an
icon in the chat input box, next to the attachment button (`src/components/chat/
Composer.tsx`).

**Acceptance criteria:**
- A compact icon-button in the Composer's button row (next to attachments), enabled when
  the current thread has history and no stream is in flight; shows progress while running.
- Compaction asks the thread's current provider/model to summarize the conversation so
  far (reusing the existing `chatStream` path), then makes subsequent sends carry
  `[summary] + messages after the compaction point` instead of the full history
  (`store/threads.ts` `send()` assembles history today).
- **Decide and document persistence:** non-destructive is preferred — keep all rows in
  `messages` for display and store the summary + cutoff marker (e.g. a synthetic message
  row with a new `kind`/flag via a numbered migration, or a `threads` column) so the UI
  still shows the full transcript but the API context is compacted. If destructive
  (replacing old messages), require an explicit confirm.
- The compaction point is visible in the transcript (e.g. a divider/note row), and
  compacting twice composes sanely.
- Works with project/system context (T10/T20): the global/project system messages are
  not summarized away — only the message history is.

**Notes:**
- Mind the FTS index (T19): if message rows are deleted/rewritten, the triggers keep
  `search_fts` in sync; a summary stored as a synthetic message would become searchable —
  decide if that's acceptable.
- A slash command `/compact` (T14 built-in) could alias the same action — optional.
- 2026-06-12 (Agent-T28): Implemented, **non-destructive**. Migration
  `009_compaction.sql` (version 9 — 008 was taken by the in-flight duration work) adds
  `messages.kind TEXT NOT NULL DEFAULT 'normal'` (`'normal' | 'summary'`); no rows are
  ever deleted/rewritten. Compacting inserts one synthetic `role: assistant`,
  `kind: 'summary'` row at the compaction point.
- 2026-06-12 (Agent-T28): Pure logic in `src/lib/compaction.ts` (unit-tested in
  `compaction.test.ts`): `compactHistory(messages)` returns [latest summary injected as
  a leading **user** turn (safe first-non-system role for all four providers) + messages
  after it], or the full transcript when never compacted; `buildCompactionRequest`
  frames that compacted slice (so compacting twice composes) with a system prompt + a
  closing user instruction, images stripped; `canCompact` requires ≥2 messages after the
  last compaction point.
- 2026-06-12 (Agent-T28): Store (`store/threads.ts`): new `compact()` action +
  `compacting` flag — calls the thread's provider/model via the existing `chatStream`
  (no streaming placeholder), persists the summary row + its token usage (T16), and
  reuses busy/error conventions (`busy` is set, so Stop cancels; a cancelled compaction
  persists nothing). `send()` now assembles API history via `compactHistory(...)`;
  global/project/skills system messages are unshifted afterwards as before, so they are
  never summarized away (T10/T20 intact).
- 2026-06-12 (Agent-T28): UI: Composer gains a `FoldVertical` icon button next to
  attach (spinner while compacting; enabled only for a saved thread with ≥1 exchange
  since the last compaction, provider enabled + key present, not busy). `MessageList`
  renders `kind === 'summary'` rows as a muted "Conversation compacted" divider with the
  summary text behind a `<details>` disclosure; the full transcript stays visible.
- 2026-06-12 (Agent-T28): FTS (T19): the migration-004 triggers reference no message
  column lists, so the new column needs nothing; summary rows are indexed on insert and
  therefore searchable — accepted (a summary is real conversation content; noted in the
  migration header).
- 2026-06-12 (Agent-T28): Verified: `npm run build`, `npm run lint`, `npm test`
  (220 passed, incl. 13 new compaction tests), `cargo build`, `cargo clippy`
  (0 warnings), `cargo fmt --check` — all green.

---

## T29 — Incognito chats (purged on app exit)

- **Status:** done
- **Owner:** Agent-T29
- **Priority:** P2
- **Layer:** Frontend + DB (migration) + small Rust touch (exit hook)
- **Depends on:** —

(IDEAS 2.) An incognito mode for chats: an incognito thread lives only for the current
app session and is deleted before/when the app closes. Useful for throwaway or sensitive
conversations.

**Acceptance criteria:**
- A way to start an incognito chat (e.g. a toggle on "New chat" / an incognito new-chat
  action in the sidebar and quick overlay), with a clear visual indicator on the thread
  row + chat view while active.
- Incognito threads are flagged in the DB (numbered migration, e.g.
  `threads.ephemeral INTEGER NOT NULL DEFAULT 0`) so they survive *within* a session
  (thread switching still works) but are purged at end-of-session.
- **Purge is crash-safe:** delete all `ephemeral` threads (messages + attachments,
  explicit child deletes like `deleteThread`) on app **startup** (`init()` in
  `store/threads.ts`) in addition to a best-effort purge on quit — so a crash or kill
  never leaks an incognito chat to the next session.
- "App closed" means actual exit, not hide-to-tray (close-to-tray keeps the session
  alive; tray Quit / `quit_app` / window close with close-to-tray off end it).
- Incognito threads never become `last_thread_id`, and their FTS rows are removed by the
  existing delete triggers (verify).

**Notes:**
- Frontend owns the DB (Stage 1), so the startup purge is the authoritative one; a
  Rust exit-hook purge would need its own SQLite access — prefer frontend-only.
- 2026-06-12 (Agent-T29): Migration `010_incognito.sql` (version 10, registered in
  `migrations()` in `src-tauri/src/lib.rs`): `threads.ephemeral INTEGER NOT NULL
  DEFAULT 0`. `Thread` type gains `ephemeral`; `createThread` accepts an `ephemeral`
  flag; new `purgeEphemeralThreads()` in `src/lib/db.ts` deletes all ephemeral threads
  with explicit child deletes (attachments → usage → messages → threads), mirroring
  `deleteThread`. FTS verified: the migration-004 `search_fts` delete triggers fire per
  deleted message/thread row, so index entries are cleaned automatically.
- 2026-06-12 (Agent-T29): Store (`store/threads.ts`): `startNewChat(opts?: {
  incognito?: boolean })` sets a new `draftIncognito` flag (reset by plain
  `startNewChat` and `startNewChatInProject`); the first `send`/`postNote` creates the
  thread with `ephemeral = 1`. **Crash-safe purge:** `init()` awaits
  `purgeEphemeralThreads()` FIRST, before listing threads / restoring
  `last_thread_id`. `last_thread_id` exclusion: `send`/`postNote` skip the write for
  ephemeral threads, and `selectThread` gates it via the pure, unit-tested
  `shouldRememberThread()` (unknown thread → remember, preserving pre-T29 behavior).
- 2026-06-12 (Agent-T29): Quit semantics: tray Quit / File→Quit call `app.exit` in
  Rust — the frontend cannot intercept those, so the startup purge is the documented
  guarantee for them (and for crashes/kills). Best-effort quit purge added in
  `App.tsx` via `onCloseRequested`: registering the JS listener defers the close, so
  when close-to-tray is OFF we purge then let the window be destroyed; when ON we
  `preventDefault()` (the Rust handler already hid the window — the JS wrapper would
  otherwise `destroy()` it and break hide-to-tray), keeping the session and its
  incognito threads alive.
- 2026-06-12 (Agent-T29): UI: Ghost icon button next to "New chat" in the sidebar
  (chats mode); `ThreadRow` shows a Ghost badge + muted italic title with an
  explanatory tooltip; `ChatView` shows "Incognito — this chat is deleted when the app
  exits." above the composer for an incognito thread or draft. Incognito threads
  otherwise behave normally (rename/delete/favorite/switching). Quick overlay
  (`QuickInput`) incognito path is out of scope per task guidance — not added (sending
  into an existing incognito thread from the overlay still works and stays ephemeral).
- 2026-06-12 (Agent-T29): Tests: new `store/threads.incognito.test.ts` (purge-before-
  list ordering in `init`, `last_thread_id` gating, draft-flag lifecycle,
  `shouldRememberThread`); `threads.defaultModel.test.ts` mock extended with
  `purgeEphemeralThreads`. Verified: `npm run build`, `npm run lint`, `npm test`
  (252 passed), `cargo build`, `cargo clippy`, `cargo fmt --check` — all green.

---

## T30 — Appearance: accent + background color pickers

- **Status:** done
- **Owner:** Agent-T30-T33
- **Priority:** P3
- **Layer:** Frontend
- **Depends on:** —

(IDEAS 3.) Let the user pick the theme's main (accent) color and background color
directly from the Appearance settings, without authoring a full T11 theme folder.

**Acceptance criteria:**
- Color pickers in Settings → Appearance (`src/components/settings/Appearance.tsx`) for
  at least **accent** (`--primary` family) and **background** (`--background` family),
  with a reset-to-default per color.
- Custom colors are applied as CSS-variable overrides (same mechanism as installed theme
  CSS — e.g. a dedicated `<style>` element like `applyInstalledThemeCss`) and persist in
  localStorage (synchronous at startup, no flash — mirrors `lib/theme.ts`).
- Composes sensibly with light/dark and with installed/plugin themes — decide and
  document precedence (suggested: custom picks override the active theme) and whether a
  pick applies to both light and dark or is per-mode.
- Derived tokens stay readable (e.g. `--primary-foreground` contrast when the accent
  changes) — compute or document limits.

**Notes:**
- Keep the picker dependency-light (a native `<input type="color">` styled to match may
  be enough; WebKitGTK support verified).
- 2026-06-12 (Agent-T30-T33): Implemented. New "Colors" card in `Appearance.tsx`
  (native `<input type="color">` + per-color Reset, no new deps); pure helpers +
  persistence in `src/lib/appearance.ts` (unit-tested, `appearance.test.ts`), state in
  `src/store/appearance.ts` (`useAppearance`).
- 2026-06-12: **Decisions** — (1) Picks are **per-mode**: a pick edits whichever of
  light/dark is currently active and is stored separately for each (one localStorage key
  `custom-colors`, `{ light: {…}, dark: {…} }`). (2) **Precedence:** custom picks
  override installed/plugin themes — overrides are emitted into
  `<style id="custom-colors">` with doubled-specificity scopes
  (`:root:not(.dark), body:not(.dark)` / `:root.dark, body.dark`), which beat a theme's
  `:root`/`.dark` rules regardless of style-element order (body mirrored for the
  WebKitGTK portal quirk). (3) **Contrast:** `--primary-foreground` (and `--foreground`
  for background picks) is computed from WCAG relative luminance → white or near-black
  (`contrastForeground`, unit-tested). Hex values are valid CSS var values since all
  consumers use `var()` (Tailwind v4 `--color-* : var(--*)` mapping).
- 2026-06-12: **Documented limits** — only `--primary`/`--background` (+ computed
  foregrounds) are overridden; derived surfaces (`--card`, `--muted`, `--sidebar`, …)
  keep theme values. Picker seed colors when unset are sRGB approximations of the
  built-in palette (a color input can't display oklch), so the seed may not match an
  installed theme until a pick is made. Startup apply is module-level in
  `store/appearance.ts` (side-effect import in `App.tsx`), before first paint — no
  flash. Verified: `npm run build`, `npm run lint`, `npm test` (243 passed) all green.

---

## T31 — Quick-input overlay: choose destination thread

- **Status:** done
- **Owner:** Agent-T31
- **Priority:** P2
- **Layer:** Frontend (overlay + App handler) + small Rust touch (payload/event)
- **Depends on:** —

(IDEAS 4.) When the global-shortcut overlay (`QuickInput`) opens, let the user choose
where the message goes: default **new thread** (current behavior), or one of the **5 most
recent chats**.

**Acceptance criteria:**
- The overlay shows a destination picker (compact — e.g. a row of chips or a small
  listbox navigable with arrow keys without leaving the input), defaulting to "New chat"
  and listing the 5 most recently updated threads by title.
- Submitting routes correctly: new thread keeps today's `startNewChat()` + `send(...)`
  path; an existing thread selects it (`selectThread`) and sends into it with its saved
  provider/model.
- The overlay still never touches the DB — get recents to it another way (e.g. Rust's
  `show_quick` emits an event the main window answers with the recent-thread list over
  an event to the `quick` window, or main pushes the list whenever threads change).
  Document the choice. `submit_quick`'s payload (`QuickPayload`) gains an optional
  `thread_id`; `App`'s `quick-submit` listener branches on it.
- Works when there are fewer than 5 threads (or none), and a recent that was deleted
  mid-session falls back to "New chat" gracefully.

**Notes:**
- Default shortcut is `Alt+Space` (user-customizable — Ctrl+Space in the idea is just a
  rebinding); behavior must not depend on the specific accelerator.
- Keyboard-first: the overlay is a speed feature — picking a destination must not cost
  the user their typing flow (e.g. Tab cycles destinations, Enter still sends).
- 2026-06-12 (Agent-T31): **Recents delivery — request/answer per show** (chosen over
  push-on-change to avoid emitting to a hidden window on every thread update): Rust
  `show_quick` emits `quick-recents-request` to `main`; App's quick-submit effect answers
  by `emitTo("quick", "quick-recents", recentDestinations(threads))` from the in-memory
  store (no DB query; overlay stays DB-free). Event names + pure helpers
  (`recentDestinations` sort/slice, `cycleDestination`, `destinationThreadId`) in new
  `src/lib/quickDestinations.ts`, 10 Vitest cases in `quickDestinations.test.ts`.
- 2026-06-12 (Agent-T31): Overlay (`QuickInput.tsx`): chip row under the textarea —
  "New chat" (default) + up to 5 recent titles (truncated, radiogroup semantics).
  Tab / Shift+Tab / Ctrl+Up/Down cycles chips without leaving the textarea (chips are
  `tabIndex=-1`; click also selects); Enter still sends; selection resets to "New chat"
  on each show (also handles a recents list that shrank). ModelChooser + "Start chat"
  label only show for the new-chat destination (an existing thread keeps its saved
  provider/model).
- 2026-06-12 (Agent-T31): `QuickPayload` gained optional `thread_id` (snake_case like
  `media_type`; Rust `submit_quick` forwards the payload as opaque `serde_json::Value`,
  so no Rust struct change). App's `quick-submit` listener branches: id present **and**
  still in the store → `selectThread(id)` then `send(...)`; absent/stale → unchanged
  `startNewChat()` + draft provider/model path. No capability edits needed —
  `core:default` already includes `core:event:default` (`allow-emit-to`, verified in
  gen/schemas). Verified: `npm run build`, `npm run lint` (own files; concurrent agents'
  in-flight files caused transient unrelated errors), `npm test` (220 incl. 10 new),
  `cargo build`/`clippy` clean, `cargo fmt --check` clean for `quick.rs` (lib.rs diff
  belongs to the compaction task).

---

## T32 — Language packs (i18n), bundled + user-installable

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

---

## T33 — Appearance: font family + size for UI and chat

- **Status:** done
- **Owner:** Agent-T30-T33
- **Priority:** P3
- **Layer:** Frontend
- **Depends on:** —

(IDEAS 6.) Let the user choose fonts and font sizes from the Appearance panel — separately
for the **app UI** and for **chat content** (messages), since reading prose and scanning
chrome have different needs.

**Acceptance criteria:**
- Settings → Appearance gains a typography section with: UI font family, chat font
  family, UI font size, and chat font size (sizes as a small step range, e.g. S/M/L/XL or
  a px slider with sane bounds), each with reset-to-default.
- Font family options: the bundled default plus system/common fonts. Decide and document
  the source — a curated list (safe) vs. enumerating installed system fonts (needs a Rust
  command; `font-kit`/`fontdb` or platform tooling). A free-text family input is an
  acceptable escape hatch.
- Applied via CSS variables (e.g. `--font-sans` for UI, a new `--font-chat` consumed by
  `MessageList`/`Markdown` content, and a root font-size token) so it composes with
  themes (T11) and light/dark; persisted in localStorage and applied synchronously at
  startup, no flash (mirror `lib/theme.ts`).
- Chat font settings affect message rendering (including Markdown body, but **not** code
  blocks' monospace) without breaking layout; UI size changes keep the title bar,
  sidebar, and composer usable at min/max.

**Notes:**
- Mind WebKitGTK font rendering quirks on Linux; verify the chosen mechanism there.
- Code blocks keep their mono stack — only consider a separate mono override if cheap.
- 2026-06-12 (Agent-T30-T33): Implemented. New "Typography" card in `Appearance.tsx`
  (UI font, chat font, UI size, chat size — each with Reset); CSS builders/persistence
  in `src/lib/appearance.ts` (unit-tested), state in `src/store/appearance.ts`, applied
  via `<style id="custom-typography">` (separate element from the T30 colors one).
- 2026-06-12: **Decisions** — (1) Font source is a **curated list** (`FONT_OPTIONS`:
  System default, Inter, Roboto, Open Sans, Noto Sans, Lato, Source Sans 3, Georgia,
  Noto Serif, system serif, JetBrains Mono, system monospace) + a **free-text input**
  ("Custom…") as the escape hatch — no Rust font enumeration. Free text is sanitized
  (`cssFontFamily`: strips CSS-breaking chars, quotes names, appends a generic
  fallback). (2) Sizes are **px sliders**: UI 13–18px (default 16) applied as the root
  `html { font-size }` so all rem-based sizing scales; chat 14–20px (default 14).
  (3) UI family sets `--font-sans` **and** explicit `font-family` on
  `html, body, .font-sans, .font-heading` — required because Tailwind v4's
  `@theme inline` inlines token values into utilities, so overriding the variable alone
  wouldn't restyle them.
- 2026-06-12: Chat font/size apply through new tokens `--font-chat` /
  `--chat-font-size`, consumed by a `.chat-content` class added (one-line touch) to the
  message-content wrapper in `MessageList.tsx` — inert when nothing is customized, so
  the upcoming MessageList restyle (T34) only needs to keep that class on the content
  wrapper. Inner `text-sm` utilities are neutralized to `inherit` (and
  `text-base`/`text-lg` markdown headings remapped to em) so the pick reaches the
  prose; code blocks keep `font-mono` (own declaration wins over inheritance).
  Persisted in localStorage key `custom-typography`; module-level startup apply (same
  path as T30), no flash. Verified: `npm run build`, `npm run lint`, `npm test`
  (243 passed, incl. 23 new appearance tests) all green.

---

## T34 — Chat layout styles (bubbles & friends)

- **Status:** done
- **Owner:** Agent-T34-T35
- **Priority:** P3
- **Layer:** Frontend
- **Depends on:** —

(IDEAS 7.) An Appearance option choosing how messages render in the chat. The current
style stays the default; add a few distinct, genuinely useful alternatives.

**Acceptance criteria:**
- An Appearance "Chat style" selector with (at least) these modes:
  - **Default** — the current flat full-width layout, unchanged.
  - **Bubbles** — messenger-style: user messages right-aligned in accent-tinted bubbles,
    assistant left-aligned in muted bubbles, capped bubble width.
  - **Compact** — dense, IRC-like: minimal padding, small role prefix on one line with
    the text, tight markdown spacing; for small windows / long sessions.
  - **Document** — distraction-light reading mode: user prompts render as section
    headings/quotes, assistant prose flows full-width like an article.
- Implemented as a presentation concern only in `src/components/chat/MessageList.tsx`
  (+ a wrapper class consumed by styles) — no store/DB/message-shape changes; streaming,
  images, code blocks, copy buttons, and the scroll-to-search-hit flash (T19) work
  identically in every mode.
- Persisted like the other appearance prefs (localStorage, synchronous at startup);
  switching modes re-renders live without losing scroll position (best-effort).
- Each mode is usable in light + dark and with installed themes (use tokens, not
  hardcoded colors).

**Notes:**
- Keep modes few and distinct — a mode should change reading ergonomics, not just
  decoration. Bubble mode interacts with wide content (tables/code): let such blocks
  break out of the capped width rather than squish.
- 2026-06-12 (Agent-T34-T35): Implemented. Pref `chatStyle`
  (default/bubbles/compact/document) lives with the other appearance prefs:
  persistence helpers in `src/lib/appearance.ts` (localStorage key `chat-style`,
  absent/unknown → "default", unit-tested), state + setter on `useAppearance`
  (`src/store/appearance.ts`, seeded synchronously — no flash, no CSS injection
  needed since it's a pure render-mode pref). Appearance gains a "Chat style"
  card (ToggleGroup) in `settings/Appearance.tsx`.
- 2026-06-12: `MessageList.tsx` restyle is presentation-only: the non-summary
  branch moved into a `ChatMessage` helper (same ref/id wiring for the T19
  scroll/flash, same images/tool-chips/Markdown/meta children in every mode,
  `chat-content` T33 font hook kept on the content wrapper; the T28 summary
  divider renders identically in all modes). Per-mode classes via
  `styleClasses()`; the scroll container gets a `chat-style-<mode>` hook class.
  **Bubbles:** user right in `bg-primary/10`, assistant left in `bg-muted`, both
  capped at 75%; an unlayered `:has(pre, table)` rule in `index.css` lets an
  assistant bubble with code/tables break out to full width instead of
  squishing. **Compact:** gap-1/p-2 container, fixed-width "you"/"ai" gutter
  prefix, Markdown margins tightened by `.chat-style-compact` rules in
  `index.css` targeting the my-/mt-/mb- utility classes (same trick as T33's
  `:where(.text-sm)` overrides — unlayered beats Tailwind's layered utilities).
  **Document:** user prompts as full-width `border-l-2 border-primary/60
  text-base font-semibold` section headings, assistant prose full-width, gap-6.
  All colors are tokens (`bg-primary/10`, `bg-muted`, `border-primary/60`), so
  modes follow light/dark + installed themes. Mode switches don't touch the
  scroll effect's deps, so scroll position survives (best-effort).
  Verified: `npm run build`, `npm run lint`, `npm test` (274 passed) green.

---

## T35 — Sidebar chat-list row styles

- **Status:** done
- **Owner:** Agent-T34-T35
- **Priority:** P3
- **Layer:** Frontend
- **Depends on:** —

(IDEAS 8.) Customize what a thread row in the sidebar chat list shows. Default stays
title-only; offer richer variants for users who want more context per row.

**Acceptance criteria:**
- An Appearance "Chat list" selector with 4 modes:
  - **Title** (default) — exactly today's single-line row.
  - **Title + date** — second line with the thread's last-activity date (relative for
    recent, e.g. "2h ago", absolute beyond a week; `Intl`-formatted).
  - **Detailed** — title, date, and the thread's provider/model (resolve the model id to
    its configured label where possible).
  - **Preview** — title + a one-line snippet of the last message (truncated, no markdown
    artifacts — strip/flatten formatting).
- Applies to `ThreadRow`/`ChatsPane` (and the Favorites group) without breaking
  double-click-rename, the star toggle, delete, or selection highlighting; row height
  adapts per mode and the list stays smooth with many threads.
- Preview mode sources the last message efficiently — one query for the visible list
  (e.g. a `lastMessage` join helper in `src/lib/db.ts`), not per-row queries; incognito
  (T29, if landed) and empty threads degrade gracefully.
- Persisted like the other appearance prefs (localStorage); the picker shows a small
  inline preview of each style.

**Notes:**
- Composes with T24 (Chats/Projects panes) — Projects mode's thread lists should follow
  the same row style for consistency.
- 2026-06-12 (Agent-T34-T35): Implemented. Pref `chatListStyle`
  (title/title-date/detailed/preview) follows the same pattern as T34: helpers
  in `src/lib/appearance.ts` (localStorage key `chat-list-style`, default
  "title", unit-tested), state on `useAppearance`. `ThreadRow.tsx` renders an
  optional second line under the title (title button became a two-line column;
  rename input, star, delete, selection highlight, and the T29 Ghost
  badge/italic are untouched; row height adapts naturally). Date via new pure
  `formatThreadDate(updatedAt, now)` in `src/lib/time.ts` (relative `relativeTime`
  under 7 days, `Intl.DateTimeFormat` absolute beyond — year only when it
  differs; unit-tested incl. the 7-day boundary). Detailed mode resolves
  provider/model labels via the existing `currentModelLabel`
  (`lib/modelOptions.ts`) against `useProviders()` + the `useModels` store
  (falls back to raw ids).
- 2026-06-12: **Preview sourcing** — new `lastMessages(threadIds)` in
  `src/lib/db.ts`: ONE query joining `messages` on a `MAX(rowid) GROUP BY
  thread_id` subquery filtered to `kind = 'normal'` (decision: T28 summary rows
  are skipped — the last real turn is the useful preview; rowid is used because
  message ids are random UUIDs and created_at has only second resolution).
  Fetched by the shared `useThreadSnippets(threads, enabled)` hook
  (`src/components/sidebar/useThreadSnippets.ts`) — runs ONLY when the style is
  "preview", refreshes when the store's thread list reloads, best-effort on
  error; used by both `ChatsPane` (incl. Favorites group) and `ProjectsPane`
  (`ProjectView` has no thread list, so the two panes cover all renders). The
  snippet is flattened by new pure `flattenSnippet` in `src/lib/markdown.ts`
  (regex flattener: strips fences/headings/lists/quotes/table chrome/inline
  markers, keeps code + link text, collapses to one line, ellipsis-truncates;
  unit-tested). Empty threads get no row → title-only; incognito threads behave
  normally until purge.
- 2026-06-12: Appearance "Chat list" card shows the four options as buttons
  with a tiny static mock row each (`ChatListRowMock` in
  `settings/Appearance.tsx`). Verified: `npm run build`, `npm run lint`,
  `npm test` (274 passed, incl. 22 new T34/T35 tests) green.

---

## T36 — Incognito mode: explainer + unmistakable visual identity

- **Status:** done
- **Owner:** Claude (T36–T39 wave)
- **Priority:** P2
- **Layer:** Frontend
- **Depends on:** — (builds on T29, done)

(IDEAS 9.) Incognito (T29) is currently marked only by a small Ghost icon + muted italic
title on the thread row (`src/components/sidebar/ThreadRow.tsx`) and a one-line hint above
the composer (`src/components/chat/ChatView.tsx`). That's too subtle for a mode with
privacy implications — make it impossible to miss, and explain honestly what it does and
does not protect.

**Acceptance criteria:**
- **Pre-first-message explainer:** when an incognito draft/thread has no messages yet, the
  empty chat area shows an explainer card stating what incognito *is* (the chat is purged
  when the app exits; it never becomes `last_thread_id`) and what it *isn't* — **your
  privacy from the provider is NOT protected: messages are still sent to the hosted
  provider** (Anthropic/OpenAI/etc.). Wording must generalize across providers (don't
  hardcode "Claude").
- **Chat-area distinction while active:** a persistent, clearly visible treatment of the
  whole chat surface (e.g. tinted/dashed border or distinct background + a labeled Ghost
  header), not just the current one-line hint. Theme tokens only — works in light/dark and
  with installed themes (T11).
- **Sidebar distinction:** the thread row reads as incognito at a glance beyond the small
  icon (e.g. tinted row background / left border + the Ghost badge). Must not break
  selection highlight, rename, favorite, delete, or the T35 row styles.
- All new strings go through the i18n catalog (`src/lib/i18n.ts`, T32) with the six
  bundled translations (`src/locales/*.json`) updated.

**Notes:**
- Files: `src/components/chat/ChatView.tsx`, `src/components/sidebar/ThreadRow.tsx`,
  `src/index.css` (if a reusable incognito tint helps), `src/locales/*.json`.
- The quick overlay has no incognito path (T29 left it out) — out of scope here too.
- 2026-06-12 (Claude): Implemented in `ChatView.tsx` + `ThreadRow.tsx`, tokens only.
  **Explainer:** an `IncognitoExplainer` card replaces the message list while an
  incognito draft/thread has no messages — Ghost icon, what it IS (session-only,
  purged on full exit, never restored as last chat) and what it ISN'T (messages
  still go to the model's provider; wording provider-generic). **Chat surface:**
  the chat column gets a dashed border + `bg-muted/20` tint and a labeled header
  strip (Ghost + "Incognito chat" + the old hint text on ≥sm); the old one-line
  hint under the list was folded into the strip. **Sidebar:** ephemeral rows get
  a dashed `border-l-2` edge + `bg-muted/40` tint (suppressed when active so the
  selection highlight wins), composing with all T35 row styles. Four new i18n
  keys (`chat.incognitoHeader`, `chat.incognitoExplainer{Title,Is,Isnt}`)
  translated in all five packs. Verified: npm build/lint/test (308) green.

---

## T37 — Local models via Ollama (Hugging Face) — built-in provider plugin

- **Status:** done
- **Owner:** Claude (T36–T39 wave)
- **Priority:** P2
- **Layer:** Rust (provider module + CLI/daemon detection) + Frontend (setup UX)
- **Depends on:** — (T12/T18 plugin model, done)

(IDEAS 10.) A default/bundled `provider`-category plugin ("Local (Ollama)") that runs
Hugging Face–sourced models locally through the **Ollama CLI/daemon**. Ollama and models
are NOT bundled with snak — ship clear in-app instructions to get rolling instead.

**Acceptance criteria:**
- New Rust provider module `src-tauri/src/providers/ollama.rs` implementing
  `Provider::stream` against the local Ollama HTTP API (`http://localhost:11434`), wired
  into the `providers::stream` match and declared as a built-in plugin manifest
  (`src-tauri/src/plugins/builtin/ollama.json`; `KNOWN_PROVIDER_IDS` in
  `src/lib/providers.ts` updated). Streaming, cancel (T3), usage capture (T16), and images
  (when the loaded model supports them — degrade gracefully) follow the existing provider
  conventions. Decide whether to use Ollama's OpenAI-compatible endpoint (reusing
  `openai::chat_completions`) or its native `/api/chat` — document the choice.
- **No API key:** the keychain/`has_api_key` send-gating must tolerate a keyless provider —
  gate on "Ollama reachable" instead of "key present".
- **Model discovery:** list locally installed models (GET `/api/tags`) into the
  ModelPicker for this provider; provide a way to pull a new model by name (e.g.
  `ollama pull <model>` staged via T17's `openInTerminal` flow, or a Rust-spawned pull
  with progress — pick one; never silently execute).
- **Setup UX:** when Ollama isn't installed/running, the provider's settings card and the
  chat gate show actionable instructions (install link, start command, a suggested first
  model) rather than raw connection errors.
- Enabled by default but inert-and-helpful when Ollama is absent; the four cloud providers
  are unaffected.

**Notes:**
- Keep scope to Ollama as the runtime; "from Hugging Face" is satisfied via Ollama's
  HF-backed registry (`ollama pull hf.co/<repo>` works). A configurable base URL can come
  later — hardcode localhost first.
- Rust dispatch currently only resolves the four known ids (`providers/mod.rs`) and T18
  enforced enablement frontend-only — this task adds the first new id since then; keep the
  fallback behavior coherent.
- 2026-06-12 (Claude): Done. **Endpoint decision (documented in `providers/ollama.rs`):**
  chat rides Ollama's OpenAI-compatible `/v1/chat/completions` through the shared
  `openai::chat_completions_stream` (Mistral-style wrapper — SSE, cancel, images, tools,
  and usage capture all reused; the compat layer maps `prompt_eval_count`/`eval_count` →
  `prompt_tokens`/`completion_tokens`, cache fields 0); discovery/health use the native
  `/api/tags` + `/api/version`. Connect failures are wrapped by `friendly_connect_error`
  ("Ollama isn't reachable… is it installed and running?"). **Keyless:** `is_keyless()`
  in `providers/mod.rs`; `chat_stream` skips the keychain for keyless ids;
  frontend `KEYLESS_PROVIDER_IDS`/`isKeylessProvider`/`withKeylessProviders` —
  `store/keys.ts` skips them, ApiKeys hides them, Composer gates send on a new
  `useOllama` status store (down → actionable notice + "Check again"), ModelChooser
  unions keyless ids into `keyed`. **Models:** `ollama_status`/`ollama_list_models`
  commands (own 1.5s-timeout clients; status never errors); `useOllama.refresh()`
  (startup + card button) reconciles daemon models into the `models` table via pure
  `reconcileOllamaModels` (never removes rows on a failed probe). **Pull:** the
  settings card ("Local (Ollama)", after Models) stages `ollama pull <name>` via T17's
  `openInTerminal` behind `isValidOllamaModelName` — never auto-executed. Manifest
  `com.snak.ollama` (builtin tests 6/5). 21 i18n keys in all five packs. Verified:
  npm build/lint/test (333) + cargo build/clippy/fmt/test (56) all green.
  **Live daemon test pending an Ollama install** (needs sudo; staged with Kasper) —
  the absent-daemon UX path is the one verified so far.

---

## T38 — Bots: named personas with avatars and per-bot memory

- **Status:** done
- **Owner:** Claude (T36–T39 wave)
- **Priority:** P2 (large — do a design pass before claiming)
- **Layer:** DB (migration) + Frontend
- **Depends on:** —

(IDEAS 11.) User-created "bots": a named persona — e.g. "John", a very professional
software engineer who always challenges your architecture, or "Maria", who cares about
food and makes sure you eat healthy — with personality instructions, an uploaded avatar
image, its own memory across conversations, and full create/edit/delete management.
Chatting with a bot should feel like chatting with a person (avatar next to the chat).
Infinite bots can be created.

**Acceptance criteria:**
- **Data model** (numbered migration, next version after `011_archive.sql`): `bots` (id,
  name, personality/instructions, nullable avatar base64 + media_type, optional default
  provider/model, timestamps), `bot_memory` (row-per-entry, mirroring `user_memory` from
  migration 005), and a nullable `threads.bot_id`. Explicit child deletes like
  `deleteThread` — no FK-cascade reliance.
- **CRUD UI:** create/edit/delete bots (name, personality text, avatar upload reusing
  `prepareImage` from `src/lib/image.ts`, default provider/model). Deleting a bot is
  confirmed; its threads survive (`bot_id` → NULL).
- **Starting a bot chat:** a way to start a new thread with a bot (sidebar and/or a bot
  gallery); the thread inherits the bot's default provider/model.
- **Context injection:** the bot's personality + its memory entries compose into the
  system context at the message-assembly layer in `store/threads.ts` `send()` (a pure
  `buildBotSystemText` helper alongside `src/lib/systemContext.ts`, unit-tested), with
  documented precedence vs the global (T10) and project (T20) context. No
  `src-tauri/src/providers/` changes.
- **Memory control:** each bot's memory is viewable/editable/deletable from its edit
  screen (manual entries, like the global Memory card). Automatic memory extraction from
  conversations is explicitly OPTIONAL/follow-up — if attempted, it must be user-visible
  and editable, never silent.
- **Avatar presence:** the bot's avatar + name render next to its assistant messages in
  `MessageList.tsx` (all four T34 chat styles) and on its thread rows; threads without a
  bot are unchanged.

**Notes:**
- The biggest of the four — recommend a `brainstorming`/design-doc pass first (like T12).
- FTS (T19): bot threads' messages index normally — nothing special needed.
- Incognito (T29) + bot can compose (ephemeral thread with `bot_id`); bot-memory writes
  from incognito threads should be skipped or explicitly confirmed.
- 2026-06-12 (Claude): Done. **Data:** migration **013** (`bots`, `bot_memory` mirroring
  `user_memory`, nullable `threads.bot_id` + indexes); `deleteBot` orphans threads
  explicitly (bot_id → NULL, memory deleted, no cascade reliance); ~12 db.ts helpers;
  `createThread` takes `botId`. **Injection:** pure `buildBotSystemText`
  (`src/lib/bots.ts`, unit-tested) — persona header + instructions + memory bullets —
  unshifted in `send()` between global and project; documented precedence
  **skills → global → bot → project → history** (bot = assistant identity, spans
  projects; project stays closest to the task). Bot-less threads byte-identical.
  **Draft flow:** lazy `draftBotId` (mirrors incognito); `startNewChatWithBot(bot)`
  seeds the bot's default provider/model only when both set, else app default;
  incognito always off for bot drafts in v1. **Memory:** manual-only (no automatic
  writes — the incognito interplay is therefore moot in v1), editable from the bot
  editor; per-entry rows like the global Memory card. **UI:** third sidebar mode
  "Bots" (`BotsPane` mirrors ProjectsPane: collapsible per-bot groups with their
  threads, new-chat/edit/delete hover actions), main-pane `BotView` + shared
  `BotEditor` (name, personality, avatar upload via `prepareImage(file, 256)`,
  default model via ModelChooser, memory list), `settings/Bots.tsx` section embedding
  the same editor; bot/project views mutually exclusive across all navigation paths.
  **Avatars:** `BotAvatar` (image or monogram) next to assistant messages in all
  EIGHT chat styles (the appearance consolidation grew T34's four — cozy swaps its
  monogram/name, compact fills the "ai" gutter, terminal a dim name marker, the rest
  get a byline) + thread-row badge + bot empty-state hint. 38 i18n keys in all five
  packs. Tests: `bots.test.ts`, `threads.bots.test.ts`, layout mode tests (373 total).
  Verified: npm build/lint/test + cargo build/clippy/fmt/test (64) all green.

---

## T39 — Document attachments: multi-format files in chats and projects

- **Status:** done
- **Owner:** Claude (T36–T39 wave)
- **Priority:** P2
- **Layer:** Rust (binary-format parsing) + Frontend (attach flow)
- **Depends on:** —

(IDEAS 12.) Attach more than images: any clear-text format (source code, md, csv, json,
…) plus parsed binary documents — pdf, docx, odt, ods, odp, ppt(x), xlsx — in both chat
messages and project files. Documents need to be parsed to text the model can read.

**Acceptance criteria:**
- **Chat attach flow:** `Composer.tsx` `addFiles` (currently filters to `image/*`) accepts
  documents; text-like files are read directly; binary formats go through a Rust
  `extract_document_text(bytes, media_type)` command returning extracted plain text
  (crates: e.g. `pdf-extract`/`lopdf` for pdf, `docx-rs` or zip+XML for docx/odt/odp/pptx,
  `calamine` for xlsx/ods — pick and document). Unsupported/failed parses surface a clear
  inline error, never a silent drop.
- **Storage:** reuse the `attachments` table (`kind = "document"`, `media_type`, extracted
  text in `data`; extend the schema via a numbered migration if a filename column is
  needed). The API payload injects the document text with a labeled wrapper (filename +
  fenced content); decide and document a per-document size budget like T20's 100k-char
  project budget.
- **Native provider documents where supported:** Anthropic supports PDF input natively —
  consult the `claude-api` skill before deciding raw-PDF-to-Anthropic vs extracted text
  everywhere; extracted-text-everywhere is the acceptable v1.
- **Projects:** the T20 project-files picker accepts the same formats, running the same
  extraction into `project_files.content` (text), so project context "just works".
- **UI:** attached documents render as a chip/card (filename, type icon, size) on the user
  message in `MessageList.tsx` and in the Composer's pending-attachment row. Note FTS
  implications (attachment text is not in `search_fts` — fine, document it).

**Notes:**
- Keep parsing in Rust (the webview has no fs access or heavy parsers); legacy binary
  `.doc`/`.ppt` (pre-OOXML) are hard — explicitly out of scope or best-effort, document
  the decision.
- Mind context-window blowups — show a size meter/warning like the project view (T20).
- 2026-06-12 (Claude): Done. **Rust** (`commands/documents.rs`): `extract_document_text`
  command (base64 in, `spawn_blocking`) over pure `detect_format`/`extract_text` —
  `pdf-extract` 0.10 under `catch_unwind` for pdf; `zip` 8.6 (deflate-only) +
  `quick-xml` 0.40 for docx/pptx/odt/odp (text capture gated to `w:t`/`a:t`/`text:p`
  subtrees so markup whitespace doesn't leak; pptx slides numerically ordered with
  `--- Slide N ---` separators); `calamine` 0.35 for xlsx/ods (per-sheet headers,
  tab-joined rows). Legacy `.doc`/`.ppt`/`.xls` are **out of scope** — classified
  frontend-side as `legacy-document` with a "save as .docx/…" error. 8 cargo tests
  with in-test-generated fixtures (incl. a hand-written minimal PDF; no binaries
  committed). Migration **012**: `attachments.filename TEXT`.
- 2026-06-12: **Frontend**: `src/lib/documents.ts` — extension-based `classifyFile`
  (File.type is empty for code files), 20 MB pre-extraction cap, **100k chars/doc**
  budget (`truncateDocumentText` + marker), `buildDocumentBlock` (labeled, fence =
  longest backtick run + 1) and `appendDocumentsToContent`. **Single injection seam:**
  `compactHistory`'s MessageView→ApiMessage mapping appends the blocks to `content` —
  covers sends, reloads, and compaction with zero provider changes (Anthropic native
  PDF deferred per the AC; `claude-api` consulted). `MessageView.documents` from
  `kind="document"` rows; `send(content, images, documents)` persists them (title falls
  back to the first document's name). Composer: classifier-driven `addFiles` (extraction
  on attach, spinner, inline per-file errors — nothing silently dropped; paste/drag
  accept any file), document chips with ext badge + char count; `canSend` blocks while
  extracting. MessageList renders chips in all chat styles (no click in v1 — only
  extracted text is stored). ProjectView routes binary docs through the same extraction
  into `project_files.content`. FTS: attachment text intentionally unindexed (noted in
  the migration header). 9 i18n keys in all five packs. Verified: npm build/lint/test
  (353) + cargo build/clippy/fmt/test (64) green; CLAUDE.md gained a T39 section.

---

## T40 — Personas: rebrand bots + profile fields, self-managed memory, mood

- **Status:** done
- **Owner:** Claude (T40 wave)
- **Priority:** P2
- **Layer:** DB (migration) + Frontend
- **Depends on:** T38

(Kasper, 2026-06-12.) Evolve T38 bots into **Personas** — it should feel like a
relationship with a person. Rebrand the UI (code/tables keep the `bots` naming);
split the profile into predefined fields; let the persona administer its own
memory; give it a persistent mood; both behaviors per-persona toggleable.

**Acceptance criteria:**
- **Rebrand:** every user-facing "Bot(s)" string becomes "Persona(s)" across all six
  languages. Internal identifiers/tables stay `bots` (no schema-rename churn).
- **Profile fields** (migration, additive): **Personality** (existing
  `instructions` column, relabeled), **Modus operandi**, **Tone of voice** — each an
  editor textarea and a labeled section in the persona system text.
- **Self-administered memory:** after each completed exchange in a persona thread
  (skipped for incognito threads), a follow-up call to the thread's model reviews the
  exchange against the persona's current memories and returns strict JSON ops
  (add/update/delete, hard caps); ops apply to the existing `bot_memory` table.
  Auto-added entries are visibly badged in the editor ("added by {name}") and remain
  fully user-editable/deletable. Failures are silent (never disturb the chat); usage
  is recorded (T16).
- **Mood:** a persistent short mood on the persona, updated by the same call when
  warranted ("a little hurt — the user snapped"), injected into the system prompt so
  it colors replies, shown in the editor with a clear/reset control.
- **Toggles:** per-persona "Let {name} manage their own memory" and "Mood", both
  default ON; the follow-up call only runs when at least one is enabled, and each
  result is applied only per its own flag.

**Notes:**
- Memory ops must round-trip through the frontend (frontend owns the DB — Stage 1);
  no Rust tool-use path. The extraction call reuses `chatStream` non-streamed.
- 2026-06-12 (Claude): Done. Migration **015** (`modus_operandi`, `tone_of_voice`,
  `auto_memory`/`mood_enabled` default 1, `mood`, `bot_memory.source 'user'|'auto'`).
  System text order: header → personality → "How you work" → "Tone of voice" →
  mood (toggle-gated — a lingering mood never leaks once off) → memory.
  **Engine** (`src/lib/personaMemory.ts`, parse layer unit-tested):
  `runPersonaMemoryUpdate` reviews each completed exchange on the thread's model
  via a strict-JSON prompt (current memories with ids + mood + the exchange),
  parses tolerantly (garbage → no-op), clamps (≤3 adds/turn, 300 chars/memory,
  120/mood), filters unknown ids, applies memory only under `auto_memory` and
  mood only under `mood_enabled`, auto-adds as `source: 'auto'`, never throws.
  Fire-and-forget at the end of `send()` — **skipped for incognito threads** and
  when both toggles are off (store-tested). Usage recording skipped (usage rows
  need message/thread FKs the background call lacks; documented). **UI:** editor
  gains Modus operandi + Tone of voice, two Switch toggles, a current-mood line
  with Reset, and "added by {name}" badges on auto memories. **Rebrand:** all
  user-facing Bot strings → Persona in six languages; code/tables keep `bots`.
  Verified: npm build/lint/test (401) + cargo build/clippy/fmt green.

---

## T41 — Ollama: richer daemon controls (IDEAS 13)

- **Status:** done
- **Owner:** Claude (T41)
- **Priority:** P3
- **Layer:** Rust + Frontend
- **Depends on:** T37

(IDEAS 13.) More built-in controls for starting/stopping Ollama beyond T37's status
probe: start/stop the daemon from the settings card (platform service vs spawned
process — decide and document), richer status (loaded models, versions), and
first-class Hugging Face model install help (`ollama pull hf.co/<repo>` flows with
curated suggestions). T37 already ships status detection + staged pulls — this is
the next increment.

- 2026-06-13 (Claude): Done. **Lifecycle decision (documented in
  `commands/ollama.rs`):** *start* spawns `ollama serve` as a detached child
  (the same "spawn a fixed OS binary" pattern as `take_screenshot` → `spectacle`;
  args are argv, never a shell string → no injection); snak does **not** manage
  platform service units (systemd `--user`/system, macOS login item) since those
  vary by install method. *Stop* is deliberately offered only at the **model**
  level (unload a loaded model), never as a daemon kill — the daemon may be a
  system-managed service snak didn't start, so killing it would be destructive
  and unreliable; unloading is safe and reversible (reloads on next use).
- 2026-06-13: **Rust** — `providers/ollama.rs` gains `OllamaRunningModel`
  `{ name, size_vram, expires_at }` + pure `parse_ps` (3 new unit tests, mirrors
  `parse_tags`) + `fetch_running` (GET `/api/ps`). New commands in
  `commands/ollama.rs`: `ollama_ps` (loaded models), `ollama_start` (spawn
  `serve`; missing-binary → actionable install message), `ollama_unload(model)`
  (validated name → `ollama stop <model>`, waits, surfaces stderr on failure).
  All three registered in `lib.rs`.
- 2026-06-13: **Frontend** — `lib/ollama.ts`: `listOllamaRunning`/`startOllama`/
  `unloadOllamaModel` wrappers + `OllamaRunningModelInfo` + a curated
  `SUGGESTED_MODELS` list (tiny/general/coder/vision + one `hf.co/...` GGUF;
  unit-tested that every name is shell-safe and an hf.co example is present).
  `store/ollama.ts`: `running`/`starting`/`error` state; `refresh()` also reads
  `/api/ps` (best-effort — a ps failure never flips the daemon to "down");
  `start()` spawns then polls status up to ~4s; `unload()` then refreshes.
  `OllamaSettings.tsx`: a **Start Ollama** button (when down; falls back to the
  existing manual steps if not installed), a **Loaded now** section listing
  running models with VRAM + per-model **Unload**, and one-click **suggested
  model** chips that stage their `ollama pull` for review (T17 — never auto-run).
- 2026-06-13: i18n: 8 new `ollama.*` keys in the catalog + all five packs.
  Verified: `npm run build`, `npm run lint`, `npm test` (446 passed, +2),
  `cargo build`/`clippy`/`fmt --check`/`test` (67, +3) — all green; touched
  files Prettier-clean. **Live daemon test pending an Ollama install** (the
  absent-daemon path + the spawn/unload command wiring are verified; seeing a
  real start/unload/loaded-list against a running daemon needs Ollama installed,
  same caveat as T37).

---

## T42 — Mermaid chart rendering (bundled plugin, IDEAS 14)

- **Status:** done
- **Owner:** Claude (T42)
- **Priority:** P3
- **Layer:** Frontend + plugin manifest
- **Depends on:** T8, T12

(IDEAS 14.) A prebundled, enabled-by-default plugin that renders ` ```mermaid `
fenced blocks in assistant messages as diagrams (T8 Markdown pipeline). Ship the
renderer in-app (no remote code per the T12 declarative security model); plugin
enablement toggles it. Mind streaming (partial mermaid source must not crash) and
the model needs no special prompting — just render the syntax when it appears.

- 2026-06-13 (Claude): Done. **New T12 `renderer` category** (5th category):
  `PluginCategory`/`PLUGIN_CATEGORIES`/`CATEGORY_LABELS` + `RendererContribution`
  `{ language }` in `src/types/plugins.ts`; `CATEGORIES` in Rust
  (`plugins/mod.rs`) extended to 5; `HostRegistry.renderers` + the `renderer`
  arm in `buildRegistry`, plus the pure `hasRenderer(reg, language)` lookup
  (`src/lib/plugins.ts`, unit-tested). Per the declarative security model a
  manifest only *names* the language — the renderer component is built-in code
  keyed by it.
- 2026-06-13: **Bundled plugin** `src-tauri/src/plugins/builtin/mermaid.json`
  (`com.snak.mermaid`, category `renderer`, `contributes: { language: "mermaid" }`,
  `enabledByDefault: true`), registered in `builtin_manifests()`; the builtins
  test went 6→7 with a renderer assertion (`com.snak.mermaid` present).
- 2026-06-13: **Rendering** — `src/components/chat/Mermaid.tsx`: mermaid v11 is
  **dynamically imported** (stays out of the main bundle — code-split into its own
  lazy chunks, not "remote code"; it's a vendored dep), rendered with
  `securityLevel: "strict"` (mermaid's built-in DOMPurify strips scripts / escapes
  HTML labels). **Streaming-safe:** `mermaid.parse(code, { suppressErrors: true })`
  gates rendering, so the partial source that arrives token-by-token never throws —
  the raw source shows in a `<pre>` until it parses to a valid diagram, then the
  SVG swaps in. **Theme-aware:** re-renders with mermaid's `dark`/`default` theme
  to match the app's resolved light/dark (`resolveTheme` + `useTheme`).
- 2026-06-13: **Wiring** — `CodeBlock.tsx` reads the host registry
  (`usePlugins(selectRegistry)`) and, for a ` ```mermaid ` block, renders
  `<Mermaid>` only when `hasRenderer(registry, "mermaid")` (and the language is the
  one built-in renderer we ship). Disabling the plugin in Settings → Plugins falls
  through to the normal highlighted code block (raw source + copy) — the documented
  "disable to show source" behavior. No model prompting; no store/DB/message-shape
  changes.
- 2026-06-13: i18n: `plugins.category.renderer` in the catalog + all five packs;
  the Plugins settings card `CATEGORY_KEYS` gained the `renderer` entry so the new
  category heading renders/translates. Tests: `buildRegistry` renderer grouping +
  `hasRenderer` cases in `plugins.test.ts`. Verified: `npm run build` (mermaid
  confirmed code-split into separate chunks, not the main bundle), `npm run lint`,
  `npm test` (444 passed, +2), `cargo build`/`clippy`/`fmt --check`/`test` (64) —
  all green; touched files Prettier-clean.

---

## T43 — @-mention a persona in any chat (one-shot, in-character reply)

- **Status:** done
- **Owner:** Claude (T43)
- **Priority:** P2
- **Layer:** DB (migration) + Frontend
- **Depends on:** T38, T40

(IDEAS 16.) From any chat — persona thread or not — bring a persona in to weigh in on
the conversation's context: type `@` in the composer, pick a persona, send. The
mentioned persona answers that one message **in character** (its T38/T40 profile,
memory, and mood injected), with the full thread history as context. The mention is
**one-shot**: it applies only to the next message and does not change the thread's
persona association (`threads.bot_id` untouched). The reply is clearly attributed —
the persona's name (and avatar) on top — so it reads as that persona stepping into
the chat.

**Acceptance criteria:**
- **Composer mentions:** typing `@` opens an autocomplete palette of personas
  (mirror the T14 slash palette UX in `Composer.tsx`: filter while typing, Up/Down,
  Tab/Enter, Esc); selecting inserts `@Name `. Pure parsing/resolution in a new
  `src/lib/mentions.ts` (unit-tested): extract mentioned personas from the draft,
  resolve names case-insensitively, handle names with spaces (decide a rule — e.g.
  match the longest persona-name prefix after `@`), and leave non-resolving `@…`
  text as plain content.
- **One-shot send flow** (in `store/threads.ts` `send()`): when the sent message
  mentions personas, the user message persists once (mention text kept literal in
  `content`), then **each** mentioned persona produces its own assistant reply —
  "if more are tagged, ask all", sequentially in mention order, each streamed via the
  normal `chatStream` path. Each persona's request injects its `buildBotSystemText`
  (personality, modus operandi, tone, mood, memory per T40) for that call only;
  documented precedence vs the skills/global/bot/project stack from T38. The thread's
  own persona (if any) is **not** auto-invoked on that message — the mention replaces
  it for this exchange (decide and document; simplest consistent rule).
- **Attribution / data model:** a numbered migration (next version after `015`) adds
  a nullable `messages.bot_id`; the persisted assistant reply records which persona
  authored it. `MessageList.tsx` renders the persona's name + `BotAvatar` on top of
  such messages in **all eight chat styles**, visually distinct from a normal reply
  (and from the thread-persona byline), per the idea: "respond with its name on top
  to make it clear it was injected". Messages with `bot_id = NULL` render unchanged.
- **Model choice:** use the thread's current provider/model for the persona's reply
  (not the persona's default) — one decision, documented; keeps multi-persona
  "ask all" on a single model and avoids surprise key/provider switches.
- **T40 interplay:** the mentioned persona's self-managed memory/mood follow-up
  (`runPersonaMemoryUpdate`) runs on its one-shot exchange under the same per-persona
  toggles and incognito skip — it talked with the user, so it may remember it.
- **Edge cases:** mention with empty question (just `@Name`) still sends (persona
  comments on the context); unknown `@name` sends as plain text (no palette match →
  no special handling); incognito threads compose (replies stay ephemeral); `busy`
  gating spans the whole multi-persona sequence, and Stop (T3) cancels the remaining
  queue.

**Notes:**
- No Rust changes expected beyond the migration — injection rides the existing
  `role:"system"` assembly seam like T38/T40; frontend owns the DB (Stage 1).
- The palette must coexist with the `/` slash palette in `Composer.tsx` (`@` can
  appear mid-text, unlike the leading-`/` rule — anchor the popup to the token being
  typed).
- Sequential "ask all" means later personas see earlier personas' replies in history —
  that's a feature (they can react to each other); document it.
- 2026-06-13 (Claude): Done. **Pure layer** `src/lib/mentions.ts` (31 tests):
  `activeMentionQuery` (caret-anchored `@token`; an `@` counts only at start/after
  whitespace, so emails never match; queries don't span spaces — multi-word names
  match the palette by first-word prefix and are completed by picking),
  `matchMentionBots`, `extractMentions` (send-time, **longest-name-wins** with
  spaces, case-insensitive plain-string compare — never RegExp-from-name — with a
  non-alphanumeric boundary after the name: `@Bobby` ≠ "Bob", `@Bob,` matches;
  dedupe by id, first-mention order), `insertMention` (`@Name ` — the trailing
  space deterministically closes the palette).
- 2026-06-13: **Data/attribution:** migration **016** (`messages.bot_id TEXT`
  nullable + index); `addMessage` takes `bot_id?`; `deleteBot` NULLs it explicitly
  (no cascade reliance). Thread-persona replies keep `bot_id = NULL` — only
  @-mention replies are attributed, so the distinct rendering is by construction.
- 2026-06-13: **Store** (`store/threads.ts`): the four system-block unshifts were
  consolidated into `loadSharedSystemBlocks(projectId)` (`head: [skills?, global?]`,
  `tail: [project?]`, loaded once per send) + `botSystemBlock(bot)` (per reply),
  and the stream/persist body into an inner `runReply(replyBot, attributeBotId)` —
  assembled `[...head, botBlock?, ...tail, ...compactHistory(rows)]` preserves the
  pre-T43 [skills, global, bot, project, …history] order exactly. Mention path:
  personas reply **sequentially in mention order**, each reloading history (so
  persona N sees 1..N-1's replies — they can react to each other, by design), all
  on the **thread's** provider/model (persona defaults ignored — documented);
  the thread's own persona is NOT auto-invoked (the mention replaces it for that
  exchange); `busy` spans the sequence and Stop (T3) cancels the remaining queue
  (the in-flight partial persists normally); `runPersonaMemoryUpdate` (T40) fires
  per mentioned persona under its own toggles + the incognito skip. Roster via
  `listBots()` from lib/db (useBots would be a store-module cycle). Zero mentions →
  the old single-reply path, behavior-identical (55 pre-existing store tests pass
  unmodified; 10 new in `threads.mentions.test.ts`).
- 2026-06-13: **Composer:** caret tracked via `onChange`/`onSelect` + a textarea
  ref; the mention palette mirrors the T14 slash palette (Up/Down/Tab/Enter/Esc,
  re-armed on edit) but anchors to the token under the caret (mid-text, unlike the
  leading-`/` rule); rows show `BotAvatar` + name + tagline; the slash palette wins
  the degenerate overlap. Pick inserts via `insertMention` and restores the DOM
  caret. Presentation reuses the slash palette's slot above the textarea (logical
  token anchoring — no pixel-positioned caret popup; deliberate UX call).
- 2026-06-13: **MessageList:** per-message `mentionBot` lookup (`m.bot_id` against
  `useBots`) wins over the thread bot; injected replies render `@Name` in
  `text-primary` across the byline styles + cozy + terminal, and an accent ring on
  the compact gutter avatar — all eight styles covered with no new per-style
  branches. The STREAM_ID placeholder carries `bot_id`, so attribution shows while
  streaming. Deleted persona → lookup fails → graceful fallback to today's
  rendering (rare anyway given the deleteBot NULL-out).
- 2026-06-13: i18n: one new key (`composer.mentionPaletteAria`) in the catalog +
  all five packs. Quick overlay/Canvas have no palette, but mentions typed there
  still resolve at send (noted; acceptable). Verified: `npm run build`, `npm run
  lint`, `npm test` (442 passed, +41), `cargo build`, `cargo clippy`,
  `cargo fmt --check`, `cargo test` (64) — all green; touched files Prettier-clean.

---

## T44 — Full-size image/diagram lightbox + download-to-disk

- **Status:** done
- **Owner:** Claude (T44)
- **Priority:** P2
- **Layer:** Frontend + Rust (native save dialog)
- **Depends on:** T8 (Markdown/code rendering), T42 (Mermaid)

A single shared full-size viewer for images and rendered Mermaid diagrams, openable from
anywhere (message images, the right-side chat panel's media gallery, and diagrams), with a
native "Save as…" download. Replaces the panel-local lightbox that previously only the media
gallery had.

**Acceptance criteria:**
- One `<ImageLightbox>` mounted at the app root (like `ConfirmDialog`), driven by a
  `useLightbox` store; backdrop / Esc / X close it.
- Clicking a message image, a panel-gallery thumbnail, or a Mermaid diagram opens it full-size.
- A **Download** button saves the content via a native save dialog (image → original format,
  diagram → `.svg`); the bytes are written from Rust (webview only holds base64) — no JS
  filesystem capability.
- When opened from the gallery (entry carries a `messageId`) it offers a "Go to message" jump.

**Notes:**
- 2026-06-13 (Claude): Implemented. New `src/store/lightbox.ts` (content = stored image or SVG;
  imperative `openLightbox`/`openLightboxSvg` helpers), `src/components/ImageLightbox.tsx`
  (mounted in `App.tsx`), `src/lib/images.ts` (`downloadImage`/`downloadSvg`/`fitSvg`). Rust
  `commands/files.rs::save_image` (base64 decode + `tauri-plugin-dialog` `blocking_save_file`),
  registered in `lib.rs`; added `dialog:default` to `capabilities/default.json` and the
  `tauri-plugin-dialog` dep. `MessageList`/`ChatPanel`/`Mermaid` now open the shared viewer
  (the panel's old local `Lightbox` was removed). 5 new `chat.*` i18n keys
  (`viewImage`/`viewDiagram`/`downloadImage`/`imageSaved`/`imageSaveFailed`) in the catalog +
  all five locale packs (the `panel.goToMessage`/`panel.close` keys it reuses already existed).
  Verified: `npm test` (446), `npm run build`/`lint`, `cargo check` all green.

---

## T45 — Sidebar thread-row right-click context menu

- **Status:** done
- **Owner:** Claude (T45)
- **Priority:** P3
- **Layer:** Frontend
- **Depends on:** T23 (favorites), T20 (projects)

Right-clicking a sidebar thread row opens a context menu mirroring the existing row actions,
so the per-row affordances aren't limited to the hover menu button.

**Acceptance criteria:**
- Right-click (and the kebab button) opens a menu with: favorite/unfavorite, move-to-project
  (submenu: "No project" + each project), rename, and delete (destructive).
- Reuses existing store actions and i18n keys; no new keys needed.

**Notes:**
- 2026-06-13 (Claude): Added shadcn `src/components/ui/context-menu.tsx` (Radix) and wrapped
  the row in `ThreadRow.tsx` with `ContextMenu`. Items reuse `toggleFavorite`, the projects
  list/move action, rename, and delete — all gated like the existing kebab menu (disabled while
  editing). Reuses `sidebar.*`/`panel.*`/`common.*` keys already in every pack. Verified with
  the full gate.

---

## T46 — UI animations with an Appearance toggle

- **Status:** done
- **Owner:** Claude (T46)
- **Priority:** P2
- **Layer:** Frontend
- **Depends on:** T30/T33 (Appearance), T36 (incognito identity)

(IDEAS 17.) Add tasteful motion that makes the app feel polished — view transitions, the
sidebar animating in, a thinking animation, an incognito ghost touch — with an Appearance
setting to toggle them off.

**Acceptance criteria:**
- A global animations on/off in Appearance settings, persisted; off = a fully static UI.
- View/screen transitions, sidebar enter, an animated thinking indicator, an incognito
  ghost animation, all gated by the toggle.

**Notes:**
- 2026-06-13 (Claude): `animations: boolean` (default on) added to the appearance store
  (`store/appearance.ts`) + `lib/appearance.ts` helpers (`getStoredAnimations`/`storeAnimations`/
  `applyAnimations`), persisted in localStorage (`animations` = "0" when off, absent = on) and
  applied at bootstrap by toggling a `.no-animations` class on `<html>`. The kill-switch
  (`index.css`) collapses every transition/animation to ~0; OS `prefers-reduced-motion` is
  honored the same way. Motion added (tw-animate-css utilities + two small keyframes): keyed
  view fade-in (`App.tsx`), inline sidebar `slide-in-from-left`+fade (`Sidebar.tsx`), a
  three-dot pulsing thinking indicator (`MessageList.tsx`, `snak-thinking-dot`), and a gentle
  float on the incognito explainer ghost (`ChatView.tsx`, `snak-ghost-float`). New `animations.*`
  i18n keys in the catalog + all five packs; `AnimationsCard` (On/Off ToggleGroup) in
  `settings/Appearance.tsx`. Round-trip test added. Verified: `npm run build`/`lint`/`test` (447).

---

## T47 — Bug: token-usage chart hover flicker

- **Status:** done
- **Owner:** Claude (T47)
- **Priority:** P2
- **Layer:** Frontend
- **Depends on:** T16/T27 (usage view)

(IDEAS 18.) Hovering the activity heatmap made the interface jump/flicker.

**Notes:**
- 2026-06-13 (Claude): Two causes in `usage/UsageView.tsx`'s `DayTooltip`: (1) position was
  computed in a `useEffect` (post-paint), so the tooltip painted once unpositioned then jumped —
  switched to `useLayoutEffect` (pre-paint); (2) the tooltip's initial style was only
  `visibility:hidden`, leaving it `position:static` and reserving space in the cell grid (the
  "jumping interface") — now starts `position:fixed` at the origin so it's out of flow until
  positioned. Verified: full frontend gate.

---

## T48 — Bug: ultra-narrow sidebar overlay covers the topbar

- **Status:** done
- **Owner:** Claude (T48)
- **Priority:** P1
- **Layer:** Frontend
- **Depends on:** T21/T25 (responsive chrome)

(IDEAS 19.) At ultra-narrow widths the overlay sidebar (`Sheet`) didn't account for the
topbar — it covered the TitleBar/MenuBar and its own hamburger.

**Notes:**
- 2026-06-13 (Claude): The shadcn `Sheet` uses `inset-y-0`/`h-full` (full viewport from top).
  Offset the sidebar `SheetContent` in `App.tsx` via inline `style` (beats the classes) to start
  below the chrome — `top: 32` (TitleBar h-8), or `60` when the inline MenuBar (h-7) is shown —
  with matching `height: calc(100% - …)`. Verified across ~360–768px.

---

## T49 — Bug: quick-chat loads models but never finds them

- **Status:** done
- **Owner:** Claude (T49)
- **Priority:** P1
- **Layer:** Frontend
- **Depends on:** —

(IDEAS 20.) The quick-input overlay's model picker spun on "loading" forever.

**Notes:**
- 2026-06-13 (Claude): Root cause — `ModelChooser` gates its list on `useKeys.loaded`, and
  `useKeys.load()` (`store/keys.ts`) had no try/catch. In the `quick` window (which loads its own
  stores), a thrown DB/keychain call left `loaded` false forever → permanent spinner. Wrapped the
  body in try/catch and always set `loaded:true` (mirrors `useModels.load()`), so a failed
  presence read degrades to "no keys present" instead of hanging. Verified: full frontend gate.

---

## T50 — Quick-chat overlay opens on the cursor's screen

- **Status:** done
- **Owner:** Claude (T50)
- **Priority:** P2
- **Layer:** Rust
- **Depends on:** —

(IDEAS 21.) On multi-monitor setups the overlay should appear on the screen where the mouse
cursor is.

**Notes:**
- 2026-06-13 (Claude): `commands/quick.rs` `show_quick` now repositions on every show, anchoring
  lower-middle on the monitor under the cursor (`w.cursor_position()` + `w.monitor_from_point`,
  falling back to `current_monitor`/`center`). Dropped the `POSITIONED`-once guard so it follows
  the cursor across monitors. Verified: `cargo build`/`clippy`/`fmt --check`/`test`.

---

## T51 — Default dark theme uses the logo palette

- **Status:** done
- **Owner:** Claude (T51)
- **Priority:** P3
- **Layer:** Frontend
- **Depends on:** T30 (color pickers)

(IDEAS 22.) Make the default dark theme match the logo: accent `#dc8add`, background
`#163e54`, mix `#000000`.

**Notes:**
- 2026-06-13 (Claude): The real default dark theme is the `.dark` block in `index.css` (the
  picker's `DEFAULT_PICKER_COLORS` is only a swatch seed). Baked the logo palette into `.dark`
  using the exact output of the existing color pipeline (`buildColorCss`/`derivedSurfaceDecls`/
  `tintedBackground`) for those three picks — kept at the base layer so installed themes (T11)
  and user picker overrides still win by load order/specificity. `--destructive`/`--chart-*`/
  `--sidebar-primary*` left as-is. `DEFAULT_PICKER_COLORS.dark` updated to match so the
  Appearance swatches + reset target the new defaults; light mode unchanged. Verified: full
  frontend gate.

---

## T52 — Web search for small models (search_web tool, configurable backend)

- **Status:** done
- **Owner:** Claude (T52)
- **Priority:** P2
- **Layer:** Rust (extend built-in `web` MCP server) + Frontend (settings + key)
- **Depends on:** T13 (MCP + built-in web server)

(IDEA 23.) Small models can't guess the URLs to `fetch_url`. Extend the built-in `web`
server with a `search_web` tool so the model can search → get URLs → fetch them. Backend is
**configurable**: keyless DuckDuckGo by default, optional API-key provider (Brave/Serper).

**Acceptance criteria:**
- A `web__search_web` tool returning a ranked title/URL/snippet list for a query.
- Default keyless backend (works out of the box); switchable to a keyed provider whose API
  key is stored in the keychain (never in the webview).
- The tool-call loop and no-tools invariant are unchanged; the system prompt nudges
  search-then-fetch.

**Notes:**
- 2026-06-13 (Claude): New `src-tauri/src/mcp/web_search.rs` — `tool_def()` (the `search_web`
  descriptor) + `search(client, args, provider)` dispatching by backend: **DuckDuckGo** (keyless,
  scrapes `html.duckduckgo.com/html/`, pure `parse_duckduckgo_html`/`decode_ddg_href`/
  `percent_decode` helpers, unit-tested), **Brave** (`api.search.brave.com`, `X-Subscription-Token`)
  and **Serper** (`google.serper.dev`, `X-API-KEY`) reading the key in-process via
  `keys::get_api_key("search.<provider>")`. `web_browse::tools()` now advertises both tools and
  `web_browse::call_tool` gained a `search_provider: Option<&str>` param routed from `mcp::mod`'s
  `ServerConfig.search_provider` (new `#[serde(default)]` field) through `builtin_call`. No
  `chat_stream` signature change — the backend rides on the web server's config entry.
  `TOOL_SYSTEM_PROMPT` (`commands/chat.rs`) updated to mention search-then-fetch. Frontend:
  `McpServer.search_provider` (snake_case to match the nested Rust field) defaulting to
  `duckduckgo` on the built-in web server (preserved through `withBuiltins`); a provider `<select>`
  + keyed-provider API-key field in the web server's row in `settings/McpServers.tsx`
  (`setSearchApiKey` → keychain account `search.<id>`). New `mcp.search*` i18n keys in the catalog
  + all five packs. Search is defensive (parse failures → "no results" text, fed back as a tool
  result, never aborting the turn). Verified: `cargo build`/`clippy`/`fmt`/`test` (83, +7
  web_search), `npm run build`/`lint`/`test` (461).

---

## T53 — Context-size display at the bottom of the chat

- **Status:** done
- **Owner:** Claude (T53)
- **Priority:** P2
- **Layer:** Frontend + settings (per-model window map)
- **Depends on:** T16 (usage), T28 (compaction), T39 (documents)

(IDEA 24.) Show how much context the next message will consume. Live **estimate** by default;
**optionally** register a per-model max context window to also show `used / max (%)` with a bar.

**Acceptance criteria:**
- A readout at the bottom of the chat showing the estimated tokens of the next request, updating
  live as the thread/draft changes.
- A settings option to register a max context window per model; when set, the readout adds a
  `used / max (%)` usage bar; models without an entry show just the estimate.

**Notes:**
- 2026-06-13 (Claude): Pure estimator `src/lib/contextSize.ts` (`estimateTokens` ≈ `len/4`,
  `estimateMessagesTokens` over the post-compaction history via `compactHistory` so document text
  rides in content + a flat per-image allowance, `estimateContextTokens` adds the unsent draft) —
  unit-tested. Display: `src/components/chat/ContextMeter.tsx` mounted at the bottom of `Composer`
  (between staged attachments and the button row); always shows `~N tokens` (labelled estimate),
  and `used / max (%)` + a fill bar (warns amber ≥90%, destructive ≥100%) when the active model has
  a configured window. Per-model windows are a JSON `{ model: maxTokens }` in the `settings` table
  (`MODEL_CONTEXT_WINDOWS_KEY`, helpers in `db.ts`), a `useContextWindows` store loaded at startup
  in `App.tsx`, and a `settings/ContextWindows` card (added to `SettingsView`) that picks from the
  configured models. `ChatView` passes the effective `model` to `Composer`. New `composer.context*`
  + `contextWindows.*` + `settings.nav.contextWindows` i18n keys in the catalog + all five packs.
  Estimates are client-side (no tokenizer); exact usage is still captured post-send by T16.
  Verified: `npm run build`/`lint`/`test` (461, incl. new estimator tests).

---

## T54 — Mermaid diagram background when enlarged

- **Status:** done
- **Owner:** Claude (T54)
- **Priority:** P3
- **Layer:** Frontend
- **Depends on:** T42 (Mermaid), T44 (lightbox)

(IDEA 25.) An enlarged Mermaid diagram (the lightbox) had no background, so it sat transparent
on the dark backdrop. Add a themed background behind the enlarged diagram (and bake it into the
downloaded SVG). Inline in-chat diagrams are unchanged.

**Notes:**
- 2026-06-13 (Claude): `src/lib/images.ts` gained `withSvgBackground(svg, bg)` (inserts an opaque
  `<rect>` covering the `viewBox`, falling back to 100%, as the first child); `fitSvg(svg, bg?)` and
  `downloadSvg(svg, bg?)` thread it through so both the on-screen enlargement and the saved `.svg`
  carry the background. The lightbox store's svg content gained an optional `bg`; `Mermaid` resolves
  it from `--card` at click time via the new `resolveCssVarColor` helper in `lib/theme.ts` (probes a
  throwaway element so the active/installed theme — oklch, hex, or override — normalises to a
  portable `rgb()`). `ImageLightbox` also sets the wrapper `bg-card` + padding so the letterbox
  margins read as a card. Unit-tested in `images.test.ts`. Verified: `npm run build`/`lint`/`test`.

---

## T55 — Deep research mode (parallel research subagents)

- **Status:** done
- **Owner:** Claude (T55)
- **Priority:** P2
- **Layer:** Rust (agent loop + dispatch) + Frontend (toggle + cards + persistence)
- **Depends on:** T13 (MCP + built-in web server, tool-call loop), T52 (web search)

(IDEA 26.) A per-thread toggle that lets the model spend more time investigating. When on, the
model (orchestrator) can call a `research__dispatch` tool to launch multiple **subagents** that
investigate subtasks — in parallel when independent, or sequentially across rounds when it needs
one answer before knowing the next question. Each subagent runs with its **own fresh context** and
the web tools, and returns only a concise summary, so the orchestrator's context isn't polluted by
raw search dumps. The UI shows each subagent being dispatched and its progress.

**Acceptance criteria:**
- A per-thread, persisted "Deep research" toggle in the Composer; off ⇒ behavior byte-identical to
  today (no `research` tool on the wire, no extra system prompt).
- The orchestrator can dispatch N subagents that run concurrently (capped) and gather info with the
  web tools, returning concise summaries the orchestrator synthesizes.
- Subagents cannot recurse (no dispatch tool in their tool list); one cancel halts everything.
- Subagent cards (dispatched → running → done/failed, task + summary) render in the chat and survive
  reload.

**Design:** `docs/superpowers/specs/2026-06-15-deep-research-mode-design.md`.

**Notes:**
- 2026-06-15 (Claude): **Backend** — extracted `chat_stream`'s tool loop into a reusable
  `run_agent_loop` (`src-tauri/src/commands/chat.rs`); the orchestrator calls it with an added
  `research__dispatch` tool (`deepResearch` arg gates it + a decomposition system prompt). A
  `research__dispatch` call is intercepted (`run_subagents`) and runs one subagent per subtask via
  the *same* loop over a fresh `[system(SUBAGENT_PROMPT), user(task)]` history with web tools only,
  `allow_dispatch=false` (depth bound 1), concurrently with
  `futures::buffer_unordered(MAX_CONCURRENT_SUBAGENTS=4)`; subagent internals stream to a throwaway
  sink `Channel` so only the lifecycle reaches the UI. Subagent token usage is summed into the
  orchestrator's `usage`. New pure module `src-tauri/src/research.rs` (tool descriptor, prompts,
  `parse_subtasks`, `aggregate_summaries`; unit-tested). New `StreamDelta.subagent` (`SubagentDelta`:
  id/phase/task/summary) in `providers/mod.rs`. Migration `020_deep_research.sql` adds
  `threads.deep_research`. **Frontend** — `chatStream` gained a `deepResearch` flag;
  `StreamEvent.subagent` + `SubagentEvent`; `MessageSubagent` + `applySubagentEvent` +
  `persistableSubagent` persisted as `kind="subagent"` attachments (`src/lib/messages.ts`); store
  `draftDeepResearch` + `setDeepResearch` + `thread.deep_research` threaded through `send`/
  `regenerate` (`src/store/threads.ts`); a `Telescope` toggle in `Composer.tsx` and a `SubagentCard`
  in `MessageList.tsx`; i18n keys in the catalog + all five packs. **Deferred (v1):** per-subagent
  nested tool-activity/source panels in the card, and a configurable cheaper subagent model — the
  card shows the summary (which cites its sources) and subagents inherit the thread's model.
  Verified: `cargo build`/`clippy`/`fmt`/`test` (129); `npm run build`/`lint`/`test` (552).
- 2026-06-15 (Claude, follow-up after first live test on Mistral showed 429s + empty
  summaries): **(1)** subagents now run under the FULL `TOOL_SYSTEM_PROMPT` + the subagent
  addendum (was the addendum only), so weak models reliably write a summary after searching
  instead of falling silent (`run_subagents`, `commands/chat.rs`). **(2)** subagent
  concurrency is configurable in **Settings → Advanced** (default lowered 4→3): new
  `Advanced.tsx` card + `deep_research_concurrency` setting (`getDeepResearchConcurrency`/
  `setDeepResearchConcurrency`, `lib/db.ts`), `chatStream` passes `subagentConcurrency`,
  threaded through `run_agent_loop`→`run_subagents`; `research::{DEFAULT_SUBAGENT_CONCURRENCY,
  MAX_SUBAGENT_CONCURRENCY, clamp_concurrency}`. **(3)** transient-failure retry with
  exponential backoff (honoring `Retry-After`, cancel-aware) for 429/502/503/504 + connect/
  timeout: shared `providers::send_with_retry` applied to anthropic/openai(+mistral)/gemini
  (not ollama — local, and it would delay the friendly "daemon down" error). New i18n
  (`advanced.*`, `common.default`) in the catalog + five packs. Verified: `cargo build`/
  `clippy`/`fmt`/`test` (132); `npm run build`/`lint`/`test` (552).

---

## T56 — Request sources: back claims with rated web sources

- **Status:** todo
- **Owner:** —
- **Priority:** P2
- **Layer:** Frontend (button + store action + rendering); reuses the existing Rust web tools
- **Depends on:** T13 (MCP + built-in web server, tool-call loop), T52 (search_web), the
  variations feature (`regenerate`)

(IDEAS 1.) Add a **Request sources** button beside the variations controls of an assistant
reply. Clicking it re-asks the model to back up the claims in that reply with web sources:
it adds per-claim **footnotes**, rates the **credibility of each source URL**, and includes
supporting **quotes**. When a claim has no findable source, the model says it can't confirm
that claim rather than inventing one. The web infrastructure already exists (`search_web` +
`fetch_url` tools, `ToolSource[]` tracking) — this is a new button + store action +
rendering, not new network code.

**Acceptance criteria:**
- A **Request sources** button rendered next to `VariationControls` in the assistant footer
  (the `trailing` slot of `AssistantMeta`, `src/components/chat/MessageList.tsx`).
- Clicking runs a new store action (mirroring `regenerate()` / `applyRegenSteer()` in
  `src/store/threads.ts` + `src/lib/variations.ts`) that re-prompts the model to verify its
  prior reply against the web using the existing `search_web` / `fetch_url` tools.
- The result renders footnotes mapping claims → sources; each web source shows a credibility
  rating and a supporting quote; reuse the existing `ToolSource[]` / tool-activity surface.
- Claims with no source are explicitly flagged as unconfirmable.
- The no-tools invariant and per-provider behavior are unchanged.

---

## T57 — Animated loading messages while the model spins up

- **Status:** todo
- **Owner:** —
- **Priority:** P3
- **Layer:** Frontend
- **Depends on:** — (T46 if a UI-animations toggle should gate it)

(IDEAS 2.) Models are sometimes slow to start replying. During that pre-first-token gap,
replace the static "Thinking…" with a rotating pool of loading messages rendered with fancy
text animations, so the wait reads as lively rather than stalled.

**Acceptance criteria:**
- During the existing `pending` window (`src/components/chat/ChatView.tsx:163`), cycle
  through a set of loading messages instead of a single fixed string.
- Messages animate via CSS — reuse `tw-animate-css` + the keyframes in `src/index.css`;
  **no new JS animation dependency**.
- The first streamed token hands control back to the growing assistant bubble exactly as
  today.
- Honors reduced-motion / the T46 UI-animations toggle where applicable.

---

## T58 — Rename projects → workspaces (full: DB + code + UI)

- **Status:** todo
- **Owner:** —
- **Priority:** P2
- **Layer:** Rust (migration) + Frontend (code symbols + UI + i18n)
- **Depends on:** —

(IDEAS 3a.) Rename the "projects" feature to "workspaces" end-to-end — the database, the
code symbols, and every user-facing string. This is the foundation the rest of the
workspace work (T59–T62) builds on.

**Acceptance criteria:**
- New migration `022_*.sql` renaming `projects` → `workspaces`, `project_files` →
  `workspace_files`, and `threads.project_id` → `threads.workspace_id` (carry the
  `quick_actions` column), via `ALTER TABLE … RENAME`. Never edit a shipped migration;
  register it in `migrations()` in `src-tauri/src/lib.rs`.
- Code symbols renamed: `store/projects.ts` → `store/workspaces.ts`, `lib/projects.ts`,
  `components/projects/*`, `ProjectsPane`, the `Project*` types (`src/types/db.ts`), and the
  `db.ts` helpers (`listProjects`, `createProject`, …).
- All user-facing strings and i18n keys say "workspace" across **all five language packs**.
- Existing data and thread associations survive the migration.
- Full gate green (`npm run build` / `lint` / `test`, `cargo build` / `clippy` / `fmt`).

---

## T59 — Workspace URL sources → condensed editable markdown

- **Status:** todo
- **Owner:** —
- **Priority:** P2
- **Layer:** Rust (fetch + HTML→markdown) + Frontend (workspace UI)
- **Depends on:** T58

(IDEAS 3b.) Let a workspace accept **URLs** as content sources. Adding a URL fetches the
page and converts it to a condensed **markdown** file stored in the workspace, editable like
any other workspace file, with the source URL recorded. Broadens the "multiple file formats"
support already started by T39 (documents).

**Acceptance criteria:**
- An add-URL affordance in the workspace view; on add, the Rust side fetches the URL and
  converts HTML → condensed markdown (reuse/extend the readable-text path behind
  `fetch_url`; add an HTML→markdown step — no such converter exists yet).
- Stored as a `workspace_files` row with the source URL recorded, editable in the file UI
  exactly like an uploaded file.
- Char budgeting consistent with `DOCUMENT_CHAR_BUDGET` / `projectFilesSize` handling.

---

## T60 — YouTube URL → summary markdown file

- **Status:** todo
- **Owner:** —
- **Priority:** P3
- **Layer:** Rust (reuse caption fetch + new summarize) + Frontend
- **Depends on:** T58, T59, the built-in YouTube MCP server (`youtube`)

(IDEAS 3c.) When YouTube is enabled, adding a YouTube URL to a workspace creates an editable
markdown file containing an LLM **summary of the video built from its captions**, with the
source URL in a front-matter/meta section. Caption access already exists and must be
**reused**, not rebuilt: `youtube_transcript` in `src-tauri/src/mcp/youtube.rs` fetches a
video's closed-caption track (InnerTube `/youtubei/v1/player`, falling back to scraping
`ytInitialPlayerResponse`) and parses the timedtext XML. **Only the summarize step is new.**

**Acceptance criteria:**
- Gated on the built-in `youtube` MCP server being enabled — so the feature can be turned
  off (when disabled, adding a YouTube URL falls back to the generic URL ingestion from T59).
- Adding a YouTube URL reuses the existing `youtube_transcript` caption-fetch path to get the
  transcript, summarizes it via the model, and stores an editable markdown file (front-matter:
  URL + summary).
- Videos without captions degrade gracefully (clear message, no crash), mirroring
  `youtube_transcript`'s existing "no captions available" handling.

---

## T61 — Per-chat workspace file selection

- **Status:** todo
- **Owner:** —
- **Priority:** P2
- **Layer:** Frontend (+ store/DB for persistence)
- **Depends on:** T58

(IDEAS 3d.) When opening or creating a chat in a workspace, let the user choose which
workspace files are relevant to that chat — **all selected by default**. Only the selected
files are injected into the chat's system context.

**Acceptance criteria:**
- A per-chat file selector that defaults to all-selected.
- System-context injection (`buildWorkspaceSystemText` + `loadSharedSystemBlocks` in
  `src/store/threads.ts`) honors the selection rather than always injecting every file.
- The selection persists per thread.

---

## T62 — Per-workspace isolated, toggleable memory

- **Status:** todo
- **Owner:** —
- **Priority:** P3
- **Layer:** Rust (migration) + Frontend
- **Depends on:** T58, the memory feature (migration 005)

(IDEAS 3e.) Give each workspace its own **isolated memory**, separate from the global memory
(migration 005), editable in the workspace UI and **toggleable on/off per workspace**.

**Acceptance criteria:**
- Per-workspace memory storage (new migration: a `workspace_id`-scoped memory table or
  column), editable in the workspace UI.
- A per-workspace enable/disable toggle for injecting that memory.
- When in a workspace with it enabled, the workspace memory composes into the system context
  (the `src/lib/systemContext.ts` seam); global memory behavior outside workspaces is
  unchanged.

---

## T63 — Workspace dashboard, profile/cover images, dedicated settings page

- **Status:** todo
- **Owner:** —
- **Priority:** P2
- **Layer:** Frontend + Rust (migration for the images) 
- **Depends on:** T58; surfaces data from T59 (URLs) and T62 (memories)

(IDEAS 3f.) Make a workspace a first-class destination. A workspace gets its own **profile
image** and **cover image**. Clicking a workspace opens a **dashboard** (rather than the
current inline detail pane), and the workspace settings move to **their own page**.

**Acceptance criteria:**
- Each workspace has a profile image and a cover image (stored alongside the workspace —
  new migration for the columns/blobs; reuse the existing image-handling seams in
  `src/lib/image.ts` / the `attachments` model where it fits).
- Clicking a workspace opens a **dashboard** view listing its **chats, files, URLs, and
  recent memories**, plus **stats** (e.g. counts / recent activity).
- The workspace settings panel (formerly the inline `ProjectView` detail pane) becomes its
  own page/route, reachable from the dashboard.
- Existing workspaces without images render with a sensible placeholder.

---

## T64 — Focus the chat input when creating a new chat

- **Status:** done
- **Owner:** Claude (T64)
- **Priority:** P3
- **Layer:** Frontend
- **Depends on:** —

(IDEAS 4.) When a new chat is created, automatically move keyboard focus to the composer
input so the user can start typing immediately.

**Acceptance criteria:**
- Triggering "New chat" (`startNewChat` in `src/store/threads.ts`) focuses the `Composer`
  textarea.
- Covers the sidebar new-chat action and any other new-chat entry points.
- Reuse the existing composer-focus seam added by the Cmd/Ctrl+L shortcut rather than adding
  a parallel mechanism.

**Notes:**
- 2026-06-17 (Claude, T64): Called `get().focusComposer()` at the end of all three
  new-chat actions — `startNewChat`, `startNewChatInProject`, and `startNewChatWithBot` —
  in `src/store/threads.ts`. Reuses the existing `composerFocus` nonce seam (introduced for
  Cmd/Ctrl+L) that the Composer already watches via a `useEffect`; no new focus path added.
  Covers the sidebar new-chat button and all other entry points. Verified: `npm run build` ✓,
  `npm run lint` ✓, `npm test` (609 pass, 2 pre-existing locale failures on the branch) ✓.
