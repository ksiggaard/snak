# T28 — Compact a chat (context summarization)

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
