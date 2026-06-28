# T38 — Bots: named personas with avatars and per-bot memory

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
