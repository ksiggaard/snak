# T37 — Local models via Ollama (Hugging Face) — built-in provider plugin

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
