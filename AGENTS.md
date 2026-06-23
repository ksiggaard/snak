# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Built (Stages 1–6 complete): **Tauri v2 + React 19 + TypeScript + Vite**, styled with **Tailwind v4 + shadcn/ui**. The SQLite data layer, OS-keychain API keys, four streaming providers, multi-thread chat, multimodal images, and the quick-input overlay / global shortcut / screenshot capture are all implemented. The system tray (icon + menu, click-to-toggle, close-to-tray) closes the last remaining gap. See the per-stage sections below for specifics.

## Toolchain & commands

Rust is installed via `rustup` (binaries in `~/.cargo/bin`; a new shell picks this up from your profile). Node 20 / npm.

Frontend (run from repo root):
- `npm run tauri dev` — launch the desktop app (builds Rust + serves Vite). Use this to see the window.
- `npm run build` — typecheck (`tsc`) + production Vite build.
- `npm run lint` — ESLint (flat config). `npm run format` / `format:check` — Prettier.

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

## Data layer (Stage 1)

- **SQLite via `tauri-plugin-sql`.** DB URL is `sqlite:snak.db` — defined as `DB_URL` in `src-tauri/src/lib.rs` and duplicated in `src/lib/db.ts`; keep them in sync.
- **Migrations** are Rust-registered (`migrations()` in `lib.rs`, SQL in `src-tauri/migrations/NNN_*.sql`, embedded via `include_str!`). They run on app startup. Add a new numbered file + a `Migration` entry with the next `version`; never edit a shipped migration.
- **Frontend access** goes through typed helpers in `src/lib/db.ts` (one connection via `getDb()`); domain types in `src/types/db.ts`. Don't call `Database.load` elsewhere.
- FK `ON DELETE CASCADE` is **not** relied upon (the plugin connection may not have `PRAGMA foreign_keys = ON`); `deleteThread` removes children explicitly.
- Granting a new plugin's permissions requires editing `src-tauri/capabilities/default.json`.

## Secrets / API keys (Stage 2)

- Provider API keys live in the **OS keychain** via the `keyring` crate (backend selected per-platform in `Cargo.toml`: macOS Keychain / Windows Cred Manager / Linux Secret Service). Service name `com.snak.app`, account = provider id.
- Commands in `src-tauri/src/commands/keys.rs`: `set_api_key`, `has_api_key`, `delete_api_key`. **`has_api_key` returns only a bool — the key is never returned to the webview.** Frontend wrappers in `src/lib/keys.ts`; settings UI in `src/components/settings/ApiKeys.tsx`.
- Tauri commands live under `src-tauri/src/commands/` (module `commands` in `lib.rs`) and must be registered in the `invoke_handler!` list.
- The provider registry (ids, labels, default models) is `src/lib/providers.ts` — the single source of truth for the provider list across settings and chat.

## Providers & chat (Stage 3)

- **Provider calls run in Rust over raw HTTP (`reqwest`).** Modules in `src-tauri/src/providers/` (`anthropic`, `openai`, `mistral`, `gemini`) each implement the `Provider` trait; `providers::complete(client, provider, req)` dispatches by id. OpenAI/Mistral share `openai::chat_completions` (Mistral is OpenAI-compatible).
- Per-provider quirks handled in their modules: Anthropic takes `system` as a top-level field + `anthropic-version` header (no Rust SDK — raw HTTP per claude-api guidance; default `max_tokens` 4096, non-streaming); Gemini maps `assistant`→`model` and uses `systemInstruction` + `x-goog-api-key`.
- The `Provider` trait has one method, **`stream(...)`** (Stage 4): it streams text deltas over a Tauri `Channel<StreamDelta>` and returns the fully-accumulated `{content, model}`. Providers parse SSE via the shared `for_each_sse_data` line driver in `providers/mod.rs` (UTF-8-safe across chunk boundaries). All four set `stream: true` (Gemini uses `:streamGenerateContent?alt=sse`).
- The command is **`chat_stream(provider, model, messages, on_delta)`** (`commands/chat.rs`) — it fetches the key from the keychain in-process (`keys::get_api_key`, crate-internal), streams deltas, and returns the full response. **The frontend owns the DB**: the store persists the user message, gathers history, calls `chatStream` (`src/lib/chat.ts`, which wires a `Channel`), then persists the returned authoritative text. (No Rust-side `send_message` touches the DB — all SQL stays in the frontend per Stage 1.)
- To add a provider: add a module implementing `Provider::stream`, a match arm in `providers::stream`, and an entry in `src/lib/providers.ts`.
- Chat UI: `src/components/chat/` (`ChatView`, `MessageList`, `Composer`, `ModelPicker`). During streaming the store appends a placeholder assistant message (id `STREAM_ID`) that grows with each delta, then swaps it for the persisted DB row on completion; `ChatView` shows "Thinking…" only until the first token.

## Multimodal images (Stage 6)

- Images are attached in `Composer` (file picker / paste / drag-drop), downscaled + re-encoded to JPEG client-side by `src/lib/image.ts` (`prepareImage`, max 1568px), stored **base64 in the `attachments` table** (`kind = "image"`), and sent with the user message.
- `src/lib/messages.ts` defines `MessageView` (a `Message` + its `images`) and `loadThreadMessages` (joins attachments onto user messages); the store's `messages` are `MessageView[]`, and API history carries `images`.
- API shape: `ChatMessage` (Rust) and `ApiMessage` (TS) have an `images: [{ media_type, data }]` field. **Nested command-arg fields are NOT camelCase-converted by Tauri** — only top-level args are — so these are sent snake_case (`media_type`). Per-provider encoding: Anthropic `image` blocks (`source.type=base64`), OpenAI/Mistral `image_url` data URLs, Gemini `inline_data`.

## Document attachments (T39)

- Beyond images, the Composer (and the project-files picker) accepts **documents**: clear-text/code files are read directly (`file.text()`); binary formats — pdf, docx, pptx, odt, odp, xlsx, ods — are parsed to plain text by the Rust command `extract_document_text` (`src-tauri/src/commands/documents.rs`; crates `pdf-extract`, `zip`+`quick-xml`, `calamine`). Legacy `.doc`/`.ppt`/`.xls` are rejected with a "save as .docx/…" message. Classification is extension-based (`classifyFile` in `src/lib/documents.ts`) because `File.type` is empty for code files.
- Stored as `attachments` rows with `kind = "document"`, extracted text in `data`, original name in the `filename` column (migration 012). Budgets: 20 MB pre-extraction, 100k chars per document after (`DOCUMENT_CHAR_BUDGET`, truncated with a marker). Attachment text is intentionally not in the FTS index.
- **API injection happens in one seam:** `compactHistory`'s MessageView→ApiMessage mapping appends labeled fenced blocks via `appendDocumentsToContent` — providers are untouched (document text rides in message `content`). Anthropic's native PDF input is deliberately deferred; extracted-text-everywhere is the v1.

## Threads & shared state (Stage 5)

- App state lives in a **Zustand store**, `src/store/threads.ts` (`useThreads`) — the orchestration moved here out of `ChatView`. It owns `threads`, `currentThreadId` (null = unsaved draft), `messages`, the draft provider/model, and `busy`/`error`, plus actions `init`, `selectThread`, `startNewChat`, `setProviderModel`, `send`, `rename`, `remove`.
- **Lazy thread creation:** "New chat" sets `currentThreadId = null`; the row is created in the DB on the first `send` (titled from the first message via `deriveTitle`). Empty drafts never hit the DB.
- **Last-active thread** is persisted in the `settings` table (`last_thread_id`) and restored by `init()` (called once from `App`'s mount effect).
- Sidebar `src/components/sidebar/ThreadList.tsx`: new-chat, select, double-click-to-rename, delete (confirm). `ModelPicker` sets provider+model for the current thread (persisted via `setThreadProviderModel`) or the draft.
- Components select store slices individually (`useThreads((s) => s.x)`) to limit re-renders. Sync-local-state-to-store is done with the render-time adjustment pattern (see `ModelPicker`), not `useEffect` — the `react-hooks/set-state-in-effect` rule forbids the effect form.

## Quick-input overlay, global shortcut & screenshots

- **Two windows, one bundle.** `main.tsx` routes by `getCurrentWindow().label`: `quick` → `QuickInput` overlay, anything else → `App`. The `quick` window (defined in `tauri.conf.json`) is frameless/transparent/always-on-top/hidden-by-default; transparency needs `app.macOSPrivateApi` + the `macos-private-api` Tauri feature, and `html.overlay` CSS in `index.css` makes the body transparent.
- **Global shortcut** (`tauri-plugin-global-shortcut`, registered in Rust `lib.rs`): default `Alt+Space` (Option+Space). The Rust handler calls `show_quick`, so it fires even when the app is unfocused. Customizable via `ShortcutSetting` → `set_global_shortcut` command, persisted in `settings.global_shortcut`; `App` re-applies the saved value on startup.
- **Overlay → main flow:** the overlay never touches the DB. On submit it calls `submit_quick` (`commands/quick.rs`), which emits a `quick-submit` event to the main window, focuses main, and hides the overlay. `App` listens for `quick-submit` and runs `startNewChat()` + `send(text, images)` — reusing the normal store/streaming path, so a new thread is created with the draft provider/model.
- **Screenshots:** `take_screenshot` command runs the OS interactive region tool (`screencapture -i` on macOS, `spectacle -r` on KDE), returns base64 PNG (or null if cancelled), hiding the overlay during capture. macOS may require **Screen Recording** permission. Frontend wrappers for all of this live in `src/lib/quick.ts`.
- Commands here are desktop-only (the plugin/crate are gated to non-mobile in `Cargo.toml`); both windows are listed in `capabilities/default.json` with `global-shortcut:default`.

## Plugin system (T12 foundation)

Extensibility framework so providers/themes/skills/slash-commands can be added without core changes. **This is additive scaffolding** — the live hardcoded providers are unchanged (the providers-as-plugins swap is T18). Design doc: `docs/superpowers/specs/2026-06-09-plugin-foundation-design.md`.

- **Category taxonomy:** `provider` ("add LLM X") · `theme` · `slash-command` · `renderer` (fenced-code renderers, T42) · `audio` (`PluginCategory` in `src/types/plugins.ts`; `CATEGORIES` in Rust). **Skills are not a plugin category** — they're standalone `SKILL.md` folders (see the Skills section below).
- **Manifest** (`manifest.json`): `{ id, name, version, category, apiVersion, description?, author?, enabledByDefault?, contributes? }`. `apiVersion` must equal the host's `API_VERSION` (currently `1`). Validation is a pure fn in **both** layers — `parse_manifest`/`validate_manifest` (`src-tauri/src/plugins/mod.rs`) and `parseManifest` (`src/lib/plugins.ts`), each unit-tested.
- **Extension points** (`contributes`, category-specific descriptors — stored/round-tripped this wave, wired by later waves): `provider` → `{ id, label, defaultModel, keyHint }` (shape-compatible with `ProviderMeta`); `theme` → `{ name, css }`; `slash-command` → `{ command, description }`; `renderer` → `{ language }` (T42). The `HostRegistry` (`buildRegistry` in `src/lib/plugins.ts`, `selectRegistry` selector in `src/store/plugins.ts`) is the seam consumers read — it returns the contributions of **enabled** plugins grouped by category, so T18/T11/T15/T14 depend on the registry, not plugin internals. `hasRenderer(reg, lang)` is the renderer lookup `CodeBlock` uses.
- **Discovery & state (Rust-owned, filesystem):** built-ins are declared in Rust (`builtin_manifests()`, seeded from `src-tauri/src/plugins/builtin/*.json` — the four current providers as metadata-only descriptors). User plugins live in app-data `…/plugins/<id>/manifest.json` (resolved via `AppHandle::path().app_data_dir()`). Enabled/disabled state is a JSON map in app-data `…/plugins/enabled.json` (absent id → manifest `enabledByDefault`) — kept Rust-side (not the `settings` table) so the backend stays authoritative for discovery *and* enablement, which T18 needs to source enabled providers.
- **Lifecycle / commands** (`src-tauri/src/plugins/mod.rs`, module `plugins`, registered in `lib.rs`): `list_plugins` (built-ins + user, merged with enabled state), `set_plugin_enabled(id, enabled)`, `uninstall_plugin(id)` (user plugins only — built-ins reject). Frontend: wrappers in `src/lib/plugins.ts`, `usePlugins` store (`src/store/plugins.ts`), and the **Plugins** settings card (`src/components/settings/Plugins.tsx`) grouping installed plugins by category with enable/disable + uninstall.
- **Security model:** plugins are **declarative** — a manifest plus static, non-executable assets (CSS text, instruction strings, descriptors). The host never loads/executes arbitrary plugin code; `provider`/`slash-command`/`renderer` *behavior* is built-in Rust/TS keyed by manifest `id`/language. No `eval`, no dynamic `import()` of plugin code, no spawning plugin binaries; theme CSS is injected via a `<style>` element (CSS only). Executable third-party plugins (would need a WASM/subprocess sandbox + permission prompt) are explicitly deferred; `apiVersion` lets a future host gate on it.
- **Renderer plugins (T42):** the built-in `com.snak.mermaid` (`renderer` category, `contributes: { language: "mermaid" }`, enabled by default) makes ` ```mermaid ` fenced blocks render as diagrams. `CodeBlock` (`src/components/chat/CodeBlock.tsx`) checks `hasRenderer(registry, "mermaid")` and, when enabled, renders `<Mermaid>` (`Mermaid.tsx`) instead of a highlighted block — mermaid is **dynamically imported** (kept out of the main bundle; this is code-splitting of a vendored dep, not loading plugin code), rendered with `securityLevel: "strict"`, theme-aware, and streaming-safe (`mermaid.parse(..., { suppressErrors })` gates rendering so partial source never throws — the raw source shows until it parses). Disabling the plugin falls through to the normal code block (raw source).

## Skills (Agent Skills standard)

Skills are **`SKILL.md` folders** — the Anthropic Agent Skills format (frontmatter `name`/`description` + markdown body + optional bundled files), the same shape used by Claude Code / the Claude API, so a `~/.claude/skills/<x>` folder is drop-in. They are **not** plugins (the old `skill` plugin category was removed).

- **Progressive disclosure (the point):** only the enabled skills' **index** (name + description) is injected into the system context (`buildSkillsIndexText` in `src/lib/skills.ts`, pushed in `loadSharedSystemBlocks`, `src/store/threads.ts`). The model loads a skill's full **body on demand** by calling the built-in `skill__load_skill` tool — so enabling many skills costs a few index lines, not many instruction packs. (The pre-redesign model injected every enabled skill's full instructions on every send; that was the context pollution this replaced.)
- **Store (Rust-owned, filesystem):** `src-tauri/src/skills/mod.rs` discovers `…/skills/<slug>/SKILL.md`, parses frontmatter (hand-parsed — no YAML dep), and owns enable-state (`…/skills/enabled.json`, default-enabled, keyed by name) — mirroring the `plugins` module. Commands: `list_skills`, `read_skill`, `save_skill`, `delete_skill`, `set_skill_enabled`, `import_skills`, `pick_skills_dir` (native folder picker via the Rust dialog plugin). Frontend wrappers in `src/lib/skills.ts`, `useSkills` store (`src/store/skills.ts`), and the **Skills** settings card (`src/components/settings/Skills.tsx`) — author (create/edit/delete), toggle, and import.
- **Action + state layer (the built-in `skill` tool server):** `src-tauri/src/mcp/skill_tool.rs` (`SERVER_ID = "skill"`) plugs into the existing MCP built-in dispatch (`mcp/mod.rs` `builtin_tools`/`builtin_call`) and the agent loop (`run_agent_loop`). Tools: `load_skill(name)` (body), `read_skill_file(skill, path)` (bundled files), and `list_workspace`/`read_workspace_file`/`write_workspace_file` (a per-thread scratch dir at `…/skill-workspace/<thread_id>/`). A `SkillRuntime { skills_dir, workspace_root }` is resolved in `chat_stream` (from the `AppHandle`) and threaded down to the dispatch. The frontend exposes the `skill` server only when ≥1 skill is enabled (`BUILTIN_SKILL_SERVER` added in `enabledServersForChat`, `src/lib/mcp.ts`), preserving the no-tools invariant.
- **Security:** consistent with the declarative model — snak **never executes** skill-bundled code (commands still go through the `/terminal` gate). Reads are confined to the named skill's folder; workspace I/O is confined to the per-thread sandbox dir; every relative path is component-checked (no `..`/absolute) and canonicalize-verified to stay within its root, with size caps (`skill_tool.rs`).

## Slash commands (T14)

Typed `/command args` in the composer, with a discovery/autocomplete palette. Pure parsing/resolution lives in `src/lib/slashCommands.ts` (unit-tested); the palette + execution live in `src/components/chat/Composer.tsx`.

- **Parsing:** `parseSlashInput(raw)` returns `{ name, args } | null`. It only treats text that *starts* with `/` whose first token is a valid command word (`/[A-Za-z0-9][\w-]*`) as a command; a leading space or a doubled `//` (literal slash) is a normal message, as is `/foo` that doesn't resolve to a known command — so non-slash sending is unchanged.
- **Discovery:** `availableCommands(contributions)` merges **built-in** commands (`BUILTIN_COMMANDS`, behavior keyed by name) with enabled **plugin** `slash-command` contributions read off the T12 host registry (`selectRegistry(usePlugins).slashCommands` → `{ command, description }`). A built-in wins over a same-named contribution. `matchCommands(prefix, …)` powers the palette filter; `resolveCommand(parsed, …)` maps a parsed input to its definition. Per the T12 declarative security model, plugin contributions advertise a command but ship **no executable code** — a contribution with no built-in handler is discoverable but, when run, posts an explanatory chat note (`kind: "note"`) instead of executing anything.
- **Palette UX:** typing `/` opens an autocomplete list (filtered by the first token; Up/Down to move, Tab/Enter to pick, Esc to dismiss). Selecting inserts `\<command\> ` so the user types args. On send, a resolved command runs via `runCommand`; everything else sends normally.
- **`/terminal <cmd>` reference (end-to-end):** declared as a built-in plugin (`src-tauri/src/plugins/builtin/terminal.json`, category `slash-command`, enabled by default) **and** as a `BUILTIN_COMMANDS` entry (`kind: "terminal"`). Running it does **not** execute anything — it opens an in-composer **confirmation gate** showing the exact command; only on the user pressing **"Stage in terminal"** does it call T17's `openInTerminal` (`src/lib/terminal.ts` → Rust `open_in_terminal`), which *stages* the command in an OS terminal (pre-typed, not auto-run — the user reviews and presses Enter there). A confirmation note (with the command in a fenced block) is then fed into the thread via the new store helper `postNote` (see below). This is the safety model: model-/user-supplied shell text is never run silently — it requires explicit confirmation and a second explicit Enter in the terminal.
- **Store touch:** `store/threads.ts` gained one additive action, `postNote(content)` — persists a synthetic `assistant`-role message into the current thread (lazily creating a draft thread exactly like `send`), with no provider/stream call. `send()`'s internals are untouched; slash output feeds the thread through `postNote`, normal messages still go through `send`.

## Intended product

A desktop LLM chat application for KDE, built as a React web app wrapped in [Tauri](https://tauri.app/).

Key intended capabilities:
- Bring-your-own-key support for multiple providers: **Mistral, OpenAI, Anthropic, and Gemini**.
- Multiple concurrent chat **threads** with an LLM.
- **Multimodal** input — both text and images.
- **Local database** for persisting threads/history (Tauri-side, on-device).
- Runs **minimized to the system tray**, summonable via a global keyboard shortcut.
- **Screenshot capture** to send directly to the LLM as a question.

## Intended architecture

Tauri splits responsibilities between two layers — keep this boundary in mind when adding features:

- **Frontend (React, web)** — chat UI, thread management, message rendering, provider selection. Runs in the Tauri webview.
- **Backend (Tauri, Rust)** — native concerns that the webview cannot do alone: local database access, system tray + global hotkey registration, screenshot capture, and likely the outbound LLM API calls (to keep API keys out of the webview and avoid CORS). Expose these to the frontend via Tauri commands.

When implementing a feature, decide first which layer owns it: anything touching the OS, the filesystem/database, or secret API keys belongs in the Rust backend and is invoked from React through Tauri's command bridge.

## When the Anthropic provider is involved

This app integrates the Anthropic API directly. Before writing or modifying Anthropic/Claude integration code (model IDs, request shapes, streaming, multimodal/image inputs, pricing), consult the `claude-api` skill rather than relying on memory.
