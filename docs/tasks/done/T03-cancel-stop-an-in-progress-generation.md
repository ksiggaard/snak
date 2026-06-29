# T3 — Cancel / stop an in-progress generation

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
