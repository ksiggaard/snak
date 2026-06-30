> 📐 **Historical design doc.** A dated, point-in-time design record — kept for the
> rationale, not as current truth. For how the feature works today,
> [`AGENTS.md`](../../../AGENTS.md) is canonical; where this doc and the code disagree,
> the code wins.

# Manual E2E — Stateful per-thread MCP sessions (via firefox-devtools-mcp)

**Feature under test:** `docs/superpowers/specs/2026-06-15-stateful-mcp-sessions-design.md`
**What this validates:** the *session lifecycle* — persistence within a thread, isolation
across threads, env-passing, config-change respawn, every teardown trigger (disable / edit /
delete / idle / app-exit), and error resilience — using a real stateful server
(`firefox-devtools-mcp`) instead of the in-repo counter mock. The browser's page + JS context
surviving across messages is a far stronger persistence proof than the counter.

> Run by hand (driving the GUI + a headless browser isn't automatable). The automated
> `#[ignore]`d test (`cargo test --lib mcp::session -- --ignored`) already covers the
> mechanism against a mock; this exercises it against a real-world server.

---

## Prerequisites

- **Node ≥ 20.19** and **Firefox 100+** installed (`node -v`, `firefox --version` / check
  `/Applications/Firefox.app`). On macOS, snak may need **Screen Recording** permission only
  for snak's own screenshot feature — not for this (the browser screenshots are in-process to
  the MCP server).
- Build & launch snak: `npm run tauri dev` (from repo root).
- A provider with tool-use support configured (Anthropic/OpenAI/Gemini/Mistral, or a local
  Ollama model that supports tools). Weak models may not chain tool calls reliably — prefer a
  strong model for this playbook.

### The server config to add (Settings → MCP → Add custom server)

| Field | Value |
|-------|-------|
| Label | `Firefox` |
| Transport | `stdio` |
| Command | `npx -y @mozilla/firefox-devtools-mcp@latest --headless --enable-script --viewport 1280x720` |
| Env | `START_URL=https://example.com` |

`--enable-script` turns on the `evaluate_script` tool (used for the strongest persistence
check). `START_URL` in **Env** doubles as the env-passing test (Scenario 4).

### Watching processes (run in a separate terminal)

Each live session = a **node** process (the MCP server) **and** a **firefox** process it
launches. Teardown must kill both.

```bash
# Snapshot of relevant processes (re-run at each checkpoint):
pgrep -fl "firefox-devtools-mcp"      # the node MCP server process(es)
pgrep -fl "firefox"                   # the headless browser process(es)

# Or watch continuously (Ctrl-C to stop):
while sleep 1; do clear; echo "== servers =="; pgrep -fl firefox-devtools-mcp; \
  echo "== browsers =="; pgrep -fl firefox; done
```

Throughout, "**N browsers**" means N distinct firefox processes in `pgrep -fl firefox`
(ignore snak's own webview). The count is the ground truth for session lifecycle.

---

## Scenario 0 — Spawn + handshake (settings refresh)

**Goal:** rmcp can launch the server, complete the initialize/initialized handshake, and list
tools; env is applied.

1. After adding the server, in the MCP settings click **Refresh** (Available tools).
2. **Expect:** the list shows `firefox__navigate_page`, `firefox__take_snapshot`,
   `firefox__click_by_uid`, `firefox__evaluate_script`, `firefox__screenshot_page`,
   `firefox__list_pages`, etc. (namespaced `firefox__<tool>`).
3. **Confirm teardown of the settings probe:** within a few seconds of the refresh finishing,
   the process watcher shows **no** lingering `firefox-devtools-mcp`/`firefox` from the refresh
   (the settings probe spawns under the reserved `__settings__` key and is closed immediately).
   ✅ proves spawn/handshake + no settings leak.

> If Refresh instead shows a **per-server error** under the tools list, the command/env is
> wrong — fix it here (this is also Scenario 8's success path in reverse).

---

## Scenario 1 — Persistence within a thread (the core guarantee)

**Goal:** the browser page **and** its JS context survive across separate user messages in the
same thread (proves the session is reused, not respawned per call).

In a **new chat** (Thread A):

1. **Message 1:** *"Use the firefox tools: navigate to https://example.com, then run
   `window.__snak_test = 42` with evaluate_script, and confirm it's set."*
   - Expect the model to call `navigate_page` then `evaluate_script`.
2. **Message 2 (same thread):** *"Using evaluate_script, read `window.__snak_test` and tell me
   its value. Don't navigate or reload first."*
   - **Expect:** the model reports **42**.
   - This is only possible if the *same* Firefox page (with its JS global) stayed alive between
     messages. A stateless/respawn implementation would return `undefined` (fresh page) or fail.
3. **Message 3 (same thread, snapshot/UID continuity):** *"Take a snapshot of the page, then
   click the 'More information...' link by its UID."*
   - **Expect:** `take_snapshot` returns UIDs and `click_by_uid` succeeds — the page is the
     live example.com, navigation proceeds to iana.org.
4. **Confirm:** `pgrep -fl firefox` shows **exactly one** browser for Thread A throughout (it
   was not killed/respawned between messages).

✅ **Pass:** `window.__snak_test` is 42 in Message 2 and the snapshot/click works in Message 3,
with a single persistent browser process.

---

## Scenario 2 — Per-thread isolation

**Goal:** each thread gets its own session (separate browser + separate state).

1. Keep Thread A as left in Scenario 1. Start a **new chat** (Thread B).
2. **Thread B, Message 1:** *"Using evaluate_script, read `window.__snak_test` and tell me its
   value."*
   - **Expect:** `undefined` (or an error that nothing is loaded) — Thread B has its own fresh
     browser; it never saw Thread A's variable.
3. **Confirm:** `pgrep -fl firefox` now shows **two** browser processes (one per thread).
4. Switch back to **Thread A**, send: *"Read `window.__snak_test` again."* → still **42**
   (Thread A's session was untouched by Thread B).

✅ **Pass:** B sees `undefined`, A still sees 42, two distinct browser processes.

---

## Scenario 3 — Multiple tool calls in one turn (single-session reuse within a turn)

**Goal:** several tool calls in one model turn reuse the one session (rmcp id-correlation).

1. In a **new chat** (Thread C), one message: *"Navigate to https://example.com, take a
   snapshot, click the 'More information...' link by UID, then take a full-page screenshot."*
2. **Expect:** the model chains `navigate_page` → `take_snapshot` → `click_by_uid` →
   `screenshot_page` within the single turn; the screenshot reflects the post-click page.
3. **Confirm:** still **one** browser process for Thread C (all four calls hit the same
   session; no mid-turn respawn).

✅ **Pass:** the chain completes against one session.

---

## Scenario 4 — Env vars reach the child

**Goal:** the `Env` field is passed to the spawned process.

1. The server already has `START_URL=https://example.com`. In a **new chat** (Thread D):
   *"Call list_pages and tell me the current URL — don't navigate first."*
2. **Expect:** the open page is **https://example.com** (the `START_URL` env value), not
   `about:blank`.
3. (Optional cross-check) Edit the server's Env to `START_URL=https://example.org`, Save, then
   in a **new thread** ask the same — expect **example.org**. (Editing also exercises
   Scenario 5.)

✅ **Pass:** the start page matches the `START_URL` you set in Env.

> If the start page is always `about:blank` regardless of Env, this build of
> firefox-devtools-mcp may only honor the `--start-url` *flag*, not the env var — in that case
> env-passing is better verified with the automated mock (Scenario-mock), and you can move on.

---

## Scenario 5 — Config-change respawn (fingerprint invalidation)

**Goal:** editing a server's command/env tears down its live sessions and the next call
respawns with the new config.

1. In **Thread A** (which has a live browser at iana.org with `__snak_test=42`), note its
   browser process id in the watcher.
2. Go to **Settings → MCP**, click **Edit** on the Firefox server, change Env to
   `START_URL=https://example.org`, click **Save**.
3. **Confirm immediately:** Thread A's old browser process **exits** (Save calls
   `mcp_close_server_sessions`, killing sessions for that server across all threads).
4. Back in **Thread A**, send: *"Read `window.__snak_test`."*
   - **Expect:** `undefined` and a **new** browser process appears — the session respawned with
     the new fingerprint; the old in-memory state (42) is gone.

✅ **Pass:** old process dies on Save; a fresh one spawns on the next message; state reset.

---

## Scenario 6 — Teardown: disable the server

**Goal:** toggling a server **off** kills its sessions across all threads.

1. Ensure at least one thread has a live Firefox (send a navigate message if needed). Note the
   browser/server processes.
2. **Settings → MCP**, toggle the Firefox server **off**.
3. **Expect:** within a couple of seconds, all `firefox-devtools-mcp` + `firefox` processes for
   it **exit** (`mcp_close_server_sessions`).
4. Toggle it back **on**; send a navigate message in a thread → a fresh session spawns.

✅ **Pass:** disabling kills the processes; re-enabling respawns on next use.

---

## Scenario 7 — Teardown: delete a thread

**Goal:** deleting a thread kills only *that* thread's sessions.

1. Have **two** threads with live browsers (e.g. Thread A and Thread B), confirmed as two
   browser processes.
2. In the sidebar, **delete Thread B** (confirm the dialog).
3. **Expect:** Thread B's browser process exits (`mcp_close_thread_sessions`); **Thread A's
   browser stays alive** (now one browser process). Switch to Thread A and confirm its state is
   intact (`__snak_test` still readable, page unchanged).

✅ **Pass:** exactly the deleted thread's session is torn down; others survive.

---

## Scenario 8 — Error resilience (bad server doesn't break chat)

**Goal:** a server that fails to start surfaces an error in settings and is logged, but never
aborts the chat.

1. **Settings → MCP**, add a second custom stdio server: Label `Broken`, Command
   `npx -y @mozilla/this-package-does-not-exist-xyz`. Keep Firefox enabled too.
2. Click **Refresh**.
   - **Expect:** a **per-server error** line appears for `Broken` (e.g. an npx/spawn failure),
     while `firefox__*` tools still list normally.
3. In a **new chat** with both enabled, send a normal navigate request.
   - **Expect:** the chat works using Firefox's tools; `Broken` simply contributes nothing.
     (In the dev console / stderr you'll see a `MCP server \`Broken\` failed to start: …` log.)
4. Remove the `Broken` server when done.

✅ **Pass:** settings shows the error against `Broken`; chat is unaffected; nothing crashes.

---

## Scenario 9 — Idle reaping (~10 minutes)

**Goal:** a session left idle past the 10-minute window is reaped; the next message respawns
fresh.

1. In a thread with a live browser, **stop sending messages**. Note the browser process.
2. Wait **> 10 minutes** (the reaper scans ~every 60 s; idle window is 600 s).
3. **Expect:** the idle browser + server processes **exit** on their own (the reaper).
4. Send a new message in that thread → a **fresh** browser spawns (prior page/JS state gone).

✅ **Pass:** idle processes self-terminate after ~10 min; next use respawns.

> Faster variant (requires a rebuild): temporarily change `reap_idle(Duration::from_secs(600))`
> in `src-tauri/src/lib.rs` to e.g. `from_secs(30)`, `npm run tauri dev`, and watch a session
> die ~30 s after going idle. Revert afterward.

---

## Scenario 10 — App-exit teardown (no orphans)

**Goal:** quitting the app cancels all sessions (`RunEvent::Exit` → `close_all`).

1. Have one or more threads with live browsers (confirm the processes).
2. **Quit snak** — use the tray **Quit** (or Cmd-Q quit), **not** close-to-tray. (Close-to-tray
   keeps the app running for the global shortcut, so sessions intentionally persist.)
3. **Expect:** all `firefox-devtools-mcp` + `firefox` processes spawned by snak **exit** within
   a few seconds (each cancel is bounded ~3 s by rmcp). No orphaned browsers remain.

✅ **Pass:** `pgrep -fl firefox` shows none of snak's browsers after a real quit.

---

## Scenario 11 — No-tools regression (baseline unchanged)

**Goal:** with no MCP servers enabled, chat behaves exactly as before the feature.

1. **Settings → MCP**, disable **every** server (Firefox + the built-in web/youtube; system
   diagnostics is already off).
2. In a new chat, send a normal question.
3. **Expect:** a normal completion, no tool activity, no spawned processes — identical to
   pre-feature behavior (the no-tools invariant).

✅ **Pass:** plain chat works; no MCP processes spawn.

---

## Results template

| # | Scenario | Pass? | Notes |
|---|----------|:-----:|-------|
| 0 | Spawn + handshake (refresh) | ☐ | |
| 1 | Persistence within a thread | ☐ | |
| 2 | Per-thread isolation | ☐ | |
| 3 | Multi-call single turn | ☐ | |
| 4 | Env reaches child | ☐ | |
| 5 | Config-change respawn | ☐ | |
| 6 | Teardown: disable | ☐ | |
| 7 | Teardown: thread delete | ☐ | |
| 8 | Error resilience | ☐ | |
| 9 | Idle reaping (~10 min) | ☐ | |
| 10 | App-exit teardown | ☐ | |
| 11 | No-tools regression | ☐ | |

**Smoke-test subset** (if short on time): 1 (persistence), 2 (isolation), 6 or 7 (teardown),
10 (app-exit). Those four cover the feature's core promises.
