# T43 — @-mention a persona in any chat (one-shot, in-character reply)

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
