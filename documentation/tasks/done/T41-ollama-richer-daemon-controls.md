# T41 — Ollama: richer daemon controls (IDEAS 13)

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
