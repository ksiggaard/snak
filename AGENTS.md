# snak — Agent Guide

The canonical architecture & conventions guide for anyone (human or AI) working in this repo.
`CLAUDE.md` just `@`-includes this file. When another doc disagrees with this one, **this one
wins** — fix the other doc.

## What snak is

A fast, private, multi-provider desktop **LLM chat app for KDE** — a React 19 web UI wrapped in
**Tauri v2** (Rust backend), styled with **Tailwind v4 + shadcn/ui**. It's bring-your-own-key,
runs on-device (SQLite, OS-keychain secrets), and is fully built: streaming chat across
providers, multi-thread history, multimodal image + document input, a global-shortcut
quick-input overlay with screenshot capture, system tray, workspaces, personas, MCP tools,
deep research, plugins, and skills. The sections below are the per-subsystem detail.

## Contents

- **Foundations:** [Toolchain & commands](#toolchain--commands) · [Conventions](#conventions) ·
  [Data layer](#data-layer) · [Secrets / API keys](#secrets--api-keys)
- **Chat core:** [Providers & chat](#providers--chat) · [Threads & shared state](#threads--shared-state) ·
  [Multimodal images](#multimodal-images) · [Document attachments](#document-attachments)
- **Native shell:** [Quick-input overlay, shortcut & screenshots](#quick-input-overlay-global-shortcut--screenshots) ·
  [System tray](#system-tray)
- **Agentic:** [MCP & tools](#mcp--tools) · [Deep research](#deep-research) · [Web search](#web-search) ·
  [Skills](#skills-agent-skills-standard)
- **Organization:** [Workspaces](#workspaces) · [Personas / bots](#personas--bots) ·
  [Token & context tracking](#token--context-tracking)
- **Extensibility:** [Plugin system](#plugin-system) · [Slash commands](#slash-commands)
- [Product & architecture](#product--architecture) · [When the Anthropic provider is involved](#when-the-anthropic-provider-is-involved)

## Toolchain & commands

Rust is installed via `rustup` (binaries in `~/.cargo/bin`; a new shell picks this up from your profile). Node 20 / npm.

Frontend (run from repo root):
- `npm run tauri dev` — launch the desktop app (builds Rust + serves Vite). Use this to see the window.
- `npm run dev` — Vite only. Open `http://localhost:1420` in a **browser** to debug the frontend with normal web devtools: **web-only mode** activates (no Tauri runtime), where every Rust command is stubbed and the SQLite layer is an in-memory fake persisted to `localStorage`. See "Web-only mode" below.
- `npm run build` — typecheck (`tsc`) + production Vite build.
- `npm run build:plugins` — compile the bundled runtime plugins into `src-tauri/resources/plugins/<id>/main.js` (runs automatically before `dev`/`build`; see [Plugin system](#plugin-system)).
- `npm run lint` — ESLint (flat config). `npm run format` / `format:check` — Prettier.

**Web-only mode** (browser debugging, no Rust): gated by `WEB_ONLY` (`src/lib/webOnly.ts`, true when `window.isTauri` is absent — so it's inert inside the Tauri webview). `src/lib/webShim.ts` (imported first in `main.tsx`) installs Tauri's `mockIPC`/`mockWindows`: it stubs all commands (`list_plugins` returns the real built-in manifests so providers work; `has_api_key`→true; `connectivity_probe`→online; `chat_stream` is **simulated** as a chunked stream so the real streaming→store→MessageList path runs) and `src/lib/webdb.ts` backs `getDb()` with an in-memory SQLite fake (CRUD on threads/messages/settings, seeded demo thread, persisted to the `snak-webdb-v1` localStorage key — clear it to reset). It's a debug harness, not a full backend (no real keychain/screenshots/tray/search/FTS).

Backend (run from `src-tauri/`):
- `cargo build` — compile the Rust backend.
- `cargo clippy` — lint. `cargo fmt` — format (`rustfmt.toml`, 100-col).

Packaging: `npm run tauri build` (produces .deb/.rpm/AppImage). On Arch-based systems the
AppImage step needs `NO_STRIP=true npm run tauri build` — linuxdeploy's bundled `strip`
can't read modern `.relr.dyn` ELF sections (see T5 in `TASKS.md`).

Runtime deps (Linux, optional): in-app media playback (e.g. the YouTube embeds plugin)
uses WebKitGTK's GStreamer backend, which needs **`gst-plugins-good`** — it provides the
`autodetect` plugin (`autoaudiosink`/`autovideosink`) WebKitGTK reaches for by default;
without it the WebKitWebProcess crashes with "GStreamer element autoaudiosink not found".
The wider codec set (`gst-plugins-bad`, `gst-plugins-ugly`, `gst-libav`) is also needed
for H.264/AAC. Install on Arch with `sudo pacman -S gst-plugins-good gst-plugins-bad
gst-plugins-ugly gst-libav` (Debian/Ubuntu: the `gstreamer1.0-plugins-*` packages).

This is **optional, not required**: the `media_playback_available` command
(`commands/media.rs`) probes for `autoaudiosink` via `gst-inspect-1.0` at runtime
(always true on macOS/Windows, which don't use GStreamer for webview media). When it
returns false the YouTube embed degrades gracefully — Play opens the video in the
system browser instead of mounting the crash-prone `<iframe>` — so snak runs fine without
these packages; they only enable *inline* playback. Frontend seam: `src/lib/media.ts`
(cached) consumed by `src/components/chat/YouTubeEmbed.tsx`.

## Conventions

- **Path alias `@/`** → `src/` (configured in `vite.config.ts` + `tsconfig.json`). Import as `@/components/...`, `@/lib/...`.
- **shadcn/ui** components live in `src/components/ui/` (generated — don't hand-edit or lint/format them; they're excluded in `eslint.config.js` and `.prettierignore`). Add more with `npx shadcn@latest add <component>`. Config in `components.json`.
- Tailwind v4 is configured via the `@tailwindcss/vite` plugin; theme tokens/CSS variables live in `src/index.css`.
- **Light/dark theme:** preference is `light`/`dark`/`system` (`system` follows the OS via `prefers-color-scheme`). State in `src/store/theme.ts` (`useTheme`), helpers in `src/lib/theme.ts`; applying it toggles the `.dark` class on `<html>`. Stored in **localStorage** (not the SQLite settings table) so it's read synchronously at startup with no flash. Control: `src/components/ThemeToggle.tsx` (cycles system→light→dark) in the header.

## Data layer

- **SQLite via `tauri-plugin-sql`.** DB URL is `sqlite:snak.db` — defined as `DB_URL` in `src-tauri/src/lib.rs` and duplicated in `src/lib/db.ts`; keep them in sync.
- **Migrations** are Rust-registered (`migrations()` in `lib.rs`, SQL in `src-tauri/migrations/NNN_*.sql`, embedded via `include_str!`). They run on app startup. Add a new numbered file + a `Migration` entry with the next `version`; never edit a shipped migration.
- **Frontend access** goes through typed helpers in `src/lib/db.ts` (one connection via `getDb()`); domain types in `src/types/db.ts`. Don't call `Database.load` elsewhere.
- FK `ON DELETE CASCADE` is **not** relied upon (the plugin connection may not have `PRAGMA foreign_keys = ON`); `deleteThread` removes children explicitly.
- Granting a new plugin's permissions requires editing `src-tauri/capabilities/default.json`.

## Secrets / API keys

- Provider API keys live in the **OS keychain** via the `keyring` crate (backend selected per-platform in `Cargo.toml`: macOS Keychain / Windows Cred Manager / Linux Secret Service). Service name `com.snak.app`, account = provider id.
- Commands in `src-tauri/src/commands/keys.rs`: `set_api_key`, `has_api_key`, `delete_api_key`. **`has_api_key` returns only a bool — the key is never returned to the webview.** Frontend wrappers in `src/lib/keys.ts`; keys are managed per-provider in `src/components/settings/CustomProviders.tsx`.
- Tauri commands live under `src-tauri/src/commands/` (module `commands` in `lib.rs`) and must be registered in the `invoke_handler!` list.
- **The app ships with no cloud providers** (only local Ollama is built-in) — they are user-added custom providers, not plugins (ADR-0010). Users add them (OpenAI, Anthropic, Mistral, Gemini, Groq, …) from the **Custom Providers** settings tab, optionally from a preset (`src/lib/providerPresets.ts`). Each is a `CustomProvider` row (`{id,label,protocol,baseUrl,defaultModel}`, in the `settings` table) carrying a wire `protocol`. The active provider list = the one built-in (local Ollama) + the user's custom providers, composed by `useProviders()` / `activeProviders()` in `src/lib/providers.ts`. On upgrade, `migrateBuiltinProviders` (`src/lib/migrateProviders.ts`) recreates a custom provider for each formerly-built-in cloud provider that already has a stored key (reusing the canonical id so keys + threads keep resolving).

## Providers & chat

- **Provider calls run in Rust over raw HTTP (`reqwest`).** Modules in `src-tauri/src/providers/`: `anthropic` and `gemini` (native APIs; base URL configurable, defaulting to the official endpoint), `openai` (`chat_completions_stream` — the shared engine for every OpenAI-compatible provider), and `ollama`. `providers::stream` dispatches local **Ollama by id**; every other provider by the wire **`protocol`** on the request — `"anthropic"`/`"gemini"` → the native module, anything else → the OpenAI engine against the provider's base URL. So Mistral, Groq, OpenRouter, DeepSeek, … are just `openai`-protocol presets (there is no `mistral` module).
- Per-provider quirks handled in their modules: Anthropic takes `system` as a top-level field + `anthropic-version` header (no Rust SDK — raw HTTP per claude-api guidance; default `max_tokens` 4096, non-streaming); Gemini maps `assistant`→`model` and uses `systemInstruction` + `x-goog-api-key`.
- The `Provider` trait has one method, **`stream(...)`** (Stage 4): it streams text deltas over a Tauri `Channel<StreamDelta>` and returns the fully-accumulated `{content, model}`. Providers parse SSE via the shared `for_each_sse_data` line driver in `providers/mod.rs` (UTF-8-safe across chunk boundaries). Each sets `stream: true` (Gemini uses `:streamGenerateContent?alt=sse`).
- The command is **`chat_stream(provider, model, messages, on_delta)`** (`commands/chat.rs`) — it fetches the key from the keychain in-process (`keys::get_api_key`, crate-internal), streams deltas, and returns the full response. **The frontend owns the DB**: the store persists the user message, gathers history, calls `chatStream` (`src/lib/chat.ts`, which wires a `Channel`), then persists the returned authoritative text. (No Rust-side `send_message` touches the DB — all SQL stays in the frontend per Stage 1.)
- To add a **provider**, users add it from the Custom Providers tab (no code) — add a preset to `src/lib/providerPresets.ts` for convenience. To support a **new wire protocol**: add a module implementing `Provider::stream`, a `protocol` arm in `providers::stream`, the value in `ProviderProtocol` (`src/lib/db.ts`), and a `<select>` option in `CustomProviders.tsx`.
- Chat UI: `src/components/chat/` (`ChatView`, `MessageList`, `Composer`, `ModelPicker`). During streaming the store appends a placeholder assistant message (id `STREAM_ID`) that grows with each delta, then swaps it for the persisted DB row on completion; `ChatView` shows "Thinking…" only until the first token.

## Multimodal images

- Images are attached in `Composer` (file picker / paste / drag-drop), downscaled + re-encoded to JPEG client-side by `src/lib/image.ts` (`prepareImage`, max 1568px), stored **base64 in the `attachments` table** (`kind = "image"`), and sent with the user message.
- `src/lib/messages.ts` defines `MessageView` (a `Message` + its `images`) and `loadThreadMessages` (joins attachments onto user messages); the store's `messages` are `MessageView[]`, and API history carries `images`.
- API shape: `ChatMessage` (Rust) and `ApiMessage` (TS) have an `images: [{ media_type, data }]` field. **Nested command-arg fields are NOT camelCase-converted by Tauri** — only top-level args are — so these are sent snake_case (`media_type`). Per-provider encoding: Anthropic `image` blocks (`source.type=base64`), OpenAI/Mistral `image_url` data URLs, Gemini `inline_data`.

## Document attachments

- Beyond images, the Composer (and the workspace-files picker) accepts **documents**: clear-text/code files are read directly (`file.text()`); binary formats — pdf, docx, pptx, odt, odp, xlsx, ods — are parsed to plain text by the Rust command `extract_document_text` (`src-tauri/src/commands/documents.rs`; crates `pdf-extract`, `zip`+`quick-xml`, `calamine`). Legacy `.doc`/`.ppt`/`.xls` are rejected with a "save as .docx/…" message. Classification is extension-based (`classifyFile` in `src/lib/documents.ts`) because `File.type` is empty for code files.
- Stored as `attachments` rows with `kind = "document"`, extracted text in `data`, original name in the `filename` column (migration 012). Budgets: 20 MB pre-extraction, 100k chars per document after (`DOCUMENT_CHAR_BUDGET`, truncated with a marker). Attachment text is intentionally not in the FTS index.
- **API injection happens in one seam:** `compactHistory`'s MessageView→ApiMessage mapping appends labeled fenced blocks via `appendDocumentsToContent` — providers are untouched (document text rides in message `content`). Anthropic's native PDF input is deliberately deferred; extracted-text-everywhere is the v1 (ADR-0011).

## Threads & shared state

- App state lives in a **Zustand store**, `src/store/threads.ts` (`useThreads`) — the orchestration moved here out of `ChatView`. It owns `threads`, `currentThreadId` (null = unsaved draft), `messages`, the draft provider/model, and `busy`/`error`, plus actions `init`, `selectThread`, `startNewChat`, `setProviderModel`, `send`, `rename`, `remove`.
- **Lazy thread creation:** "New chat" sets `currentThreadId = null`; the row is created in the DB on the first `send` (titled from the first message via `deriveTitle`). Empty drafts never hit the DB.
- **Last-active thread** is persisted in the `settings` table (`last_thread_id`) and restored by `init()` (called once from `App`'s mount effect).
- Sidebar `src/components/sidebar/ThreadList.tsx`: new-chat, select, double-click-to-rename, delete (confirm). `ModelPicker` sets provider+model for the current thread (persisted via `setThreadProviderModel`) or the draft.
- Components select store slices individually (`useThreads((s) => s.x)`) to limit re-renders. Sync-local-state-to-store is done with the render-time adjustment pattern (see `ModelPicker`), not `useEffect` — the `react-hooks/set-state-in-effect` rule forbids the effect form.

## Workspaces

A **workspace** groups threads that share base context — instructions, reference files, and optional memory — conceptually like Claude/ChatGPT "Projects". (It was literally named *projects* originally; migration `022` renamed `projects`→`workspaces`, `project_files`→`workspace_files`, `threads.project_id`→`threads.workspace_id`.) **Not** to be confused with the per-thread *skill* workspace (a scratch-file sandbox — see [Skills](#skills-agent-skills-standard)).

- **Data:** `workspaces` (id, name, `instructions`, `memory_enabled`, `quick_actions`, profile/cover images + positions), `workspace_files` (optional `source_url` for URL-ingested files), `workspace_memory` (migrations `022`–`029`). A thread can exclude specific workspace files (`024`). Store: `src/store/workspaces.ts`; SQL helpers in `src/lib/db.ts`.
- **Injection:** a workspace's instructions + files feed the system context for its threads (the same `loadSharedSystemBlocks` seam in `src/store/threads.ts` that carries the skills index).

## Personas / bots

A **persona** (a "bot") is a reusable assistant identity — its own instructions, voice, avatar, default provider/model, conversation starters, and self-managed memory.

- **Data:** `bots` (instructions, `tagline`, `modus_operandi`, `tone_of_voice`, `auto_memory`, `mood_enabled`/`mood`, `starters`, avatar, default provider/model), `bot_memory` (with `source` = `user` | `auto`), `threads.bot_id`, `messages.bot_id` (per-message attribution for @-mentions). Migrations `013`–`019`. Store: `src/store/bots.ts`.
- **Self-managed memory** (`src/lib/personaMemory.ts`): after an exchange, an off-path call to the thread's model reviews the persona's current memory and returns strict JSON (`{add, update, delete, mood}`), capped (≤3 new memories/turn, 300 chars each, 120 for mood). Auto-written rows are tagged `source: 'auto'`; user-added are `'user'`. The persona's instructions + recent memory + current mood are injected into chat context.

## Token & context tracking

- **Recorded usage:** every API response writes a `usage` row (provider, model, input/output/cache-creation/cache-read tokens; migration `003`). Display helpers in `src/lib/usage.ts` (token formatting + a GitHub-style 365-day heatmap).
- **Live context-size estimate:** `src/lib/contextSize.ts` shows a rough, provider-agnostic estimate in the composer — `ceil(chars / 4)` + ~1000 tokens/image over the (post-compaction) thread history + draft — labelled an *estimate* (exact counts are only known after a response).

## Quick-input overlay, global shortcut & screenshots

- **Two windows, one bundle.** `main.tsx` routes by `getCurrentWindow().label`: `quick` → `QuickInput` overlay, anything else → `App`. The `quick` window (defined in `tauri.conf.json`) is frameless/transparent/always-on-top/hidden-by-default; transparency needs `app.macOSPrivateApi` + the `macos-private-api` Tauri feature, and `html.overlay` CSS in `index.css` makes the body transparent.
- **Global shortcut** (`tauri-plugin-global-shortcut`, registered in Rust `lib.rs`): default `Alt+Space` (Option+Space). The Rust handler calls `show_quick`, so it fires even when the app is unfocused. Customizable via `ShortcutSetting` → `set_global_shortcut` command, persisted in `settings.global_shortcut`; `App` re-applies the saved value on startup.
- **Overlay → main flow:** the overlay never touches the DB. On submit it calls `submit_quick` (`commands/quick.rs`), which emits a `quick-submit` event to the main window, focuses main, and hides the overlay. `App` listens for `quick-submit` and runs `startNewChat()` + `send(text, images)` — reusing the normal store/streaming path, so a new thread is created with the draft provider/model.
- **Screenshots:** `take_screenshot` command runs the OS interactive region tool (`screencapture -i` on macOS, `spectacle -r` on KDE), returns base64 PNG (or null if cancelled), hiding the overlay during capture. macOS may require **Screen Recording** permission. Frontend wrappers for all of this live in `src/lib/quick.ts`.
- Commands here are desktop-only (the plugin/crate are gated to non-mobile in `Cargo.toml`); both windows are listed in `capabilities/default.json` with `global-shortcut:default`.

## System tray

- **Tray icon + menu** are built in Rust (`src-tauri/src/lib.rs`). The menu has **Quick Chat** (opens the overlay, mirrors the global shortcut and shows its live accelerator via the managed `QuickChatItem`), **Show / Hide** (toggles main-window visibility), a **Tray Icon** light/dark submenu (radio, persisted, managed by `TrayIconChecks`), and **Quit** (`app.exit(0)` — bypasses close-to-tray).
- **Left-click the tray icon** toggles the main window (show if hidden, hide if visible).
- **Close-to-tray:** closing the main window hides it instead of quitting when `close_to_tray` is on (the default). State is a managed `CloseToTray(AtomicBool)` synced from the frontend's persisted setting via the `set_close_to_tray` command.

## Plugin system

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

- **Category taxonomy:** `provider` ("add LLM X") · `theme` · `slash-command` · `renderer` (fenced-code renderers, T42) · `audio` (`PluginCategory` in `src/types/plugins.ts`; `CATEGORIES` in Rust). **Skills are not a plugin category** — they're standalone `SKILL.md` folders (see the Skills section below).
- **Manifest** (`manifest.json`): `{ id, name, version, category, apiVersion, description?, author?, enabledByDefault?, contributes?, entry?, permissions?, dependencies? }`. `entry`/`permissions` mark a **runtime** plugin (executable JS); `contributes` marks a **declarative** one. `apiVersion` must equal the host's `API_VERSION` (currently `1`). Validation is a pure fn in **both** layers — `parse_manifest`/`validate_manifest` (`src-tauri/src/plugins/mod.rs`) and `parseManifest` (`src/lib/plugins.ts`), each unit-tested.
- **Declarative extension points** (`contributes`, category-specific descriptors): `provider` → `{ id, label, defaultModel, keyHint }` (shape-compatible with `ProviderMeta`); `theme` → `{ name, css }`; `slash-command` → `{ command, description }`; `renderer` → `{ language }`. The `HostRegistry` (`buildRegistry` in `src/lib/plugins.ts`, `selectRegistry` selector in `src/store/plugins.ts`) is the seam consumers read — it returns the contributions of **enabled** declarative plugins grouped by category, so consumers depend on the registry, not plugin internals. `hasRenderer(reg, lang)` is the renderer lookup `CodeBlock` uses for the declarative built-ins. (Runtime plugins register their contributions in code instead — see below.)
- **Discovery & state (Rust-owned, filesystem):** declarative built-ins are declared in Rust (`builtin_manifests()`, `include_str!` from `src-tauri/src/plugins/builtin/*.json`). Bundled runtime built-ins ship as resources and are copied into app-data on startup (`seed_bundled_plugins`, seed-if-absent so a user-uninstalled bundled plugin stays gone). All other plugins (and the seeded copies) live in app-data `…/plugins/<id>/manifest.json` (resolved via `AppHandle::path().app_data_dir()`). Enabled/disabled state is a JSON map in app-data `…/plugins/enabled.json` (absent id → manifest `enabledByDefault`) — kept Rust-side (not the `settings` table) so the backend stays authoritative for discovery *and* enablement. (Cloud providers are user-added custom providers, not plugins — see [Secrets / API keys](#secrets--api-keys).)
- **Lifecycle / commands** (`src-tauri/src/plugins/`, module `plugins`, registered in `lib.rs`): `list_plugins` (built-ins + user, merged with enabled state), `set_plugin_enabled(id, enabled)`, `uninstall_plugin(id)` (user plugins only — built-ins reject), plus the runtime trio `read_plugin_entry` (read a plugin's `entry` JS source), `import_plugin` (validate + extract a `.zip`, zip-slip-safe + size-capped, `plugins/runtime.rs`), `pick_plugin_zip` (native file picker). Frontend: wrappers in `src/lib/plugins.ts`, `usePlugins` store (`src/store/plugins.ts`), and the **Plugins** settings card (`src/components/settings/Plugins.tsx`).

### Runtime plugins — loading & trust

- **Loading** (`src/lib/pluginLoader.ts`): for each enabled runtime plugin (topologically sorted by `dependencies`, `src/lib/pluginDeps.ts`), the loader reads the `entry` JS via `read_plugin_entry`, wraps it in a `Blob` (`text/javascript`), `await import(/* @vite-ignore */ url)`s it (the `@vite-ignore` is mandatory or Rollup tries to resolve the blob at build time), and calls `mod.activate(ctx)`. A failing plugin is logged and skipped — never breaks the app. Teardown via `teardownPlugin` (`pluginHost.ts`).
- **The `ctx` API** (`src/types/pluginApi.ts`): a plugin codes only against the `PluginContext` the host builds for it (`contextFor`, `pluginHost.ts`) — no host globals, no host-module imports. `ctx.ui.registerRenderer(language, mount)` draws a fenced block as a custom view; `ctx.ui.registerUi(slot, mount)` adds UI into `header`/`message-toolbar`/`sidebar`/`settings`; `ctx.storage` is a per-plugin `KVStore` backed by the `plugin_storage` table (migration `031`, namespaced by plugin id, **not** cascaded on uninstall so reinstalls resume). Runtime contributions land in the `useContributions` registry (`src/store/contributions.ts`: `renderers`, `uiSlots`, `llmHooks`).
- **Security / trust model:** **declarative** plugins run no code — the host supplies behavior keyed by `id`/language (no `eval`, no dynamic `import()` of *their* code; ADR-0004). **Runtime** plugins are the opposite: **unsandboxed, trusted JS** that the host genuinely executes. `permissions` is advisory ergonomics (the host just declines to populate undeclared parts of `ctx`), **not** a security boundary — installing a runtime plugin is trusting its author with the app's full privileges. What *is* enforced (in Rust, `plugins/runtime.rs`) is filesystem hygiene: zip-slip-safe, size-capped extraction and entry reads confined to the plugin's own folder. This trade-off is recorded in **ADR-0007**.
- **Renderer example — mermaid:** `com.snak.mermaid`'s `activate(ctx)` calls `ctx.ui.registerRenderer("mermaid", mount)`, so a ` ```mermaid ` fence renders as a diagram. `CodeBlock` (`src/components/chat/CodeBlock.tsx`) checks the runtime `renderers` registry first (any language a plugin registered), then the declarative `artifacts` built-in (`hasRenderer(registry, ARTIFACT_LANGUAGE)` → `ArtifactCard`), then falls back to a highlighted block. *(A stale `CodeBlock` comment still calls mermaid "the only built-in renderer" — it's now a runtime plugin.)*

## MCP & tools

snak can use **tools** via the Model Context Protocol, with the **no-tools invariant**: when no
server is enabled, the request is byte-identical to a plain completion (no `tools` field, the
chat path unchanged).

- **The agent loop** lives in `run_agent_loop` (`src-tauri/src/commands/chat.rs`): stream the provider response → run any tool calls the model emits → append synthesized assistant/tool turns → repeat, bounded by `MAX_TOOL_ROUNDS`. A tool error feeds back as a text result rather than aborting; cancellation is a shared `AtomicBool` checked throughout. Some tools require explicit user approval (`approve_tool_call` command).
- **Built-in (in-process) servers** live under `src-tauri/src/mcp/`: `web` (`web_browse.rs` fetch + `web_search.rs`), `youtube`, `device`, `image_search`, `sys` (read-only diagnostics, ships disabled), and `skill` (the [Skills](#skills-agent-skills-standard) tool server). Tools are namespaced `<server-id>__<tool>`.
- **External servers:** `stdio` (a child process per `(thread_id, server_id)`, persistent across a thread's messages, reaped on idle / thread-delete / config-change / exit — `mcp/session.rs`) and `http` (stateless POST). The design rationale for stateful sessions is **ADR-0008**.
- **Config ownership:** the frontend owns the server list (`settings.mcp_servers`, `src/lib/mcp.ts`); the built-in `skill` server is added to the enabled set only when ≥1 skill is enabled. Commands: `mcp_list_tools`, `mcp_close_thread_sessions`, `mcp_close_server_sessions`.

## Deep research

A per-thread toggle (`threads.deep_research`, migration `020`) that turns a hard research
question into **parallel subagents** instead of one model working tool-by-tool. Recorded as
**ADR-0009**.

- When on, the orchestrator gets a `research__dispatch` tool (`src-tauri/src/research.rs`). Calling it spawns N subagents via `run_subagents` (`commands/chat.rs`), each a fresh `[system, user]` history running its own `run_agent_loop` with the web tools **but not** `dispatch` (depth-bounded to 1). Concurrency is a per-thread setting, clamped `[1, 8]` (default 3).
- Subagent provider/tool deltas are swallowed (only lifecycle events reach the UI); each returns a summary, the summaries are aggregated into one tool result, and the orchestrator synthesizes the answer with source citations. Subagent token usage is attributed to the main request.

## Web search

- A built-in tool (`web__search_web`, `src-tauri/src/mcp/web_search.rs`) with pluggable backends selected on the `web` server config (`search_provider`): `duckduckgo` (default, keyless, HTML scrape), `brave`, and `serper` (JSON APIs whose keys live in the OS keychain under `search.brave` / `search.serper`, read in-process — never the webview).
- Results surface to the model as a numbered list and to the UI as clickable `ToolSource` objects.

## Skills (Agent Skills standard)

Skills are **`SKILL.md` folders** — the Anthropic Agent Skills format (frontmatter `name`/`description` + markdown body + optional bundled files), the same shape used by Claude Code / the Claude API, so a `~/.claude/skills/<x>` folder is drop-in. They are **not** plugins (the old `skill` plugin category was removed).

- **Progressive disclosure (the point):** only the enabled skills' **index** (name + description) is injected into the system context (`buildSkillsIndexText` in `src/lib/skills.ts`, pushed in `loadSharedSystemBlocks`, `src/store/threads.ts`). The model loads a skill's full **body on demand** by calling the built-in `skill__load_skill` tool — so enabling many skills costs a few index lines, not many instruction packs. (The pre-redesign model injected every enabled skill's full instructions on every send; that was the context pollution this replaced.)
- **Store (Rust-owned, filesystem):** `src-tauri/src/skills/mod.rs` discovers `…/skills/<slug>/SKILL.md`, parses frontmatter (hand-parsed — no YAML dep), and owns enable-state (`…/skills/enabled.json`, default-enabled, keyed by name) — mirroring the `plugins` module. Commands: `list_skills`, `read_skill`, `save_skill`, `delete_skill`, `set_skill_enabled`, `import_skills`, `pick_skills_dir` (native folder picker via the Rust dialog plugin). Frontend wrappers in `src/lib/skills.ts`, `useSkills` store (`src/store/skills.ts`), and the **Skills** settings card (`src/components/settings/Skills.tsx`) — author (create/edit/delete), toggle, and import.
- **Action + state layer (the built-in `skill` tool server):** `src-tauri/src/mcp/skill_tool.rs` (`SERVER_ID = "skill"`) plugs into the existing MCP built-in dispatch (`mcp/mod.rs` `builtin_tools`/`builtin_call`) and the agent loop (`run_agent_loop`). Tools: `load_skill(name)` (body), `read_skill_file(skill, path)` (bundled files), and `list_workspace`/`read_workspace_file`/`write_workspace_file` (a per-thread scratch dir at `…/skill-workspace/<thread_id>/`). A `SkillRuntime { skills_dir, workspace_root }` is resolved in `chat_stream` (from the `AppHandle`) and threaded down to the dispatch. The frontend exposes the `skill` server only when ≥1 skill is enabled (`BUILTIN_SKILL_SERVER` added in `enabledServersForChat`, `src/lib/mcp.ts`), preserving the no-tools invariant.
- **Security:** consistent with the declarative model — snak **never executes** skill-bundled code (commands still go through the `/terminal` gate). Reads are confined to the named skill's folder; workspace I/O is confined to the per-thread sandbox dir; every relative path is component-checked (no `..`/absolute) and canonicalize-verified to stay within its root, with size caps (`skill_tool.rs`).

## Slash commands

Typed `/command args` in the composer, with a discovery/autocomplete palette. Pure parsing/resolution lives in `src/lib/slashCommands.ts` (unit-tested); the palette + execution live in `src/components/chat/Composer.tsx`.

- **Parsing:** `parseSlashInput(raw)` returns `{ name, args } | null`. It only treats text that *starts* with `/` whose first token is a valid command word (`/[A-Za-z0-9][\w-]*`) as a command; a leading space or a doubled `//` (literal slash) is a normal message, as is `/foo` that doesn't resolve to a known command — so non-slash sending is unchanged.
- **Discovery:** `availableCommands(contributions)` merges **built-in** commands (`BUILTIN_COMMANDS`, behavior keyed by name) with enabled **plugin** `slash-command` contributions read off the T12 host registry (`selectRegistry(usePlugins).slashCommands` → `{ command, description }`). A built-in wins over a same-named contribution. `matchCommands(prefix, …)` powers the palette filter; `resolveCommand(parsed, …)` maps a parsed input to its definition. Per the T12 declarative security model, plugin contributions advertise a command but ship **no executable code** — a contribution with no built-in handler is discoverable but, when run, posts an explanatory chat note (`kind: "note"`) instead of executing anything.
- **Palette UX:** typing `/` opens an autocomplete list (filtered by the first token; Up/Down to move, Tab/Enter to pick, Esc to dismiss). Selecting inserts `\<command\> ` so the user types args. On send, a resolved command runs via `runCommand`; everything else sends normally.
- **`/terminal <cmd>` reference (end-to-end):** declared as a built-in plugin (`src-tauri/src/plugins/builtin/terminal.json`, category `slash-command`, enabled by default) **and** as a `BUILTIN_COMMANDS` entry (`kind: "terminal"`). Running it does **not** execute anything — it opens an in-composer **confirmation gate** showing the exact command; only on the user pressing **"Stage in terminal"** does it call T17's `openInTerminal` (`src/lib/terminal.ts` → Rust `open_in_terminal`), which *stages* the command in an OS terminal (pre-typed, not auto-run — the user reviews and presses Enter there). A confirmation note (with the command in a fenced block) is then fed into the thread via the new store helper `postNote` (see below). This is the safety model: model-/user-supplied shell text is never run silently — it requires explicit confirmation and a second explicit Enter in the terminal.
- **Store touch:** `store/threads.ts` gained one additive action, `postNote(content)` — persists a synthetic `assistant`-role message into the current thread (lazily creating a draft thread exactly like `send`), with no provider/stream call. `send()`'s internals are untouched; slash output feeds the thread through `postNote`, normal messages still go through `send`.

## Product & architecture

snak is a [Tauri](https://tauri.app/) app: a React webview frontend over a Rust backend. The
**layer boundary is the single most important rule when adding a feature** — decide which layer
owns it first:

- **Frontend (React, in the webview)** — chat UI, thread/workspace/persona management, message
  rendering, provider selection, **and all persistence** (it owns the SQLite data; see
  [Data layer](#data-layer) and ADR-0003). The webview is the least-trusted layer.
- **Backend (Rust)** — everything the webview can't or shouldn't do: OS keychain (secret API
  keys, ADR-0001), outbound provider HTTP + streaming (ADR-0002), the MCP tool loop, system
  tray + global hotkey, screenshot capture, document text extraction, and other native calls.
  Exposed to React as Tauri commands registered in `invoke_handler!` (`src-tauri/src/lib.rs`).

Rule of thumb: anything touching the OS, secret keys, or an external network endpoint belongs in
Rust and is invoked through the command bridge; the database and all UI state live in the
frontend. The *why* behind these splits is recorded in [`docs/adr/`](docs/adr/).

## When the Anthropic provider is involved

This app integrates the Anthropic API directly. Before writing or modifying Anthropic/Claude integration code (model IDs, request shapes, streaming, multimodal/image inputs, pricing), consult the `claude-api` skill rather than relying on memory.
