# snak — Agent Guide

The canonical architecture & conventions guide for anyone (human or AI) working in this repo.
`CLAUDE.md` just `@`-includes this file. When another doc disagrees with this one, **this one
wins** — fix the other doc.

This file is the **always-loaded core**: what snak is, the toolchain, conventions, the data
layer, secrets, and the frontend/backend layer boundary. **Per-subsystem detail lives in
[`docs/architecture/`](docs/architecture/)** — one file each, linked from the router below.
They are deliberately **not** `@`-included, so they load on demand when you open the one for the
subsystem you're touching, instead of polluting every session's context.

## What snak is

A fast, private, multi-provider desktop **LLM chat app for KDE** — a React 19 web UI wrapped in
**Tauri v2** (Rust backend), styled with **Tailwind v4 + shadcn/ui**. It's bring-your-own-key,
runs on-device (SQLite, OS-keychain secrets), and is fully built: streaming chat across
providers, multi-thread history, multimodal image + document input, a global-shortcut
quick-input overlay with screenshot capture, system tray, workspaces, personas, MCP tools,
deep research, plugins, and skills.

## Contents

Foundations live in this file; each subsystem links to its detail doc under `docs/architecture/`.

- **Foundations:** [Toolchain & commands](#toolchain--commands) · [Conventions](#conventions) ·
  [Data layer](#data-layer) · [Secrets / API keys](#secrets--api-keys)
- **Chat core:** [Providers & chat](docs/architecture/providers.md) ·
  [Threads & shared state](docs/architecture/threads.md) ·
  [Multimodal images](docs/architecture/multimodal.md) ·
  [Document attachments](docs/architecture/documents.md)
- **Native shell:** [Quick-input overlay, shortcut & screenshots](docs/architecture/quick-input.md) ·
  [System tray](docs/architecture/tray.md)
- **Agentic:** [MCP & tools](docs/architecture/mcp.md) ·
  [Deep research](docs/architecture/deep-research.md) ·
  [Web search](docs/architecture/web-search.md) ·
  [Skills](docs/architecture/skills.md)
- **Organization:** [Workspaces](docs/architecture/workspaces.md) ·
  [Personas / bots](docs/architecture/personas.md) ·
  [Token & context tracking](docs/architecture/token-tracking.md)
- **Extensibility:** [Plugin system](docs/architecture/plugins.md) ·
  [Slash commands](docs/architecture/slash-commands.md)
- [Product & architecture](#product--architecture) · [When the Anthropic provider is involved](#when-the-anthropic-provider-is-involved)

## Toolchain & commands

Rust is installed via `rustup` (binaries in `~/.cargo/bin`; a new shell picks this up from your profile). Node 20 / npm.

Frontend (run from repo root):
- `npm run tauri dev` — launch the desktop app (builds Rust + serves Vite). Use this to see the window.
- `npm run dev` — Vite only. Open `http://localhost:1420` in a **browser** to debug the frontend with normal web devtools: **web-only mode** activates (no Tauri runtime), where every Rust command is stubbed and the SQLite layer is an in-memory fake persisted to `localStorage`. See "Web-only mode" below.
- `npm run build` — typecheck (`tsc`) + production Vite build.
- `npm run build:plugins` — compile the bundled runtime plugins into `src-tauri/resources/plugins/<id>/main.js` (runs automatically before `dev`/`build`; see [Plugin system](docs/architecture/plugins.md)).
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
