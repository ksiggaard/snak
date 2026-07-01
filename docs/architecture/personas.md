# Personas / bots

> Part of snak's architecture guide. Core & layer boundary: [`AGENTS.md`](../../AGENTS.md).

A **persona** (a "bot") is a reusable assistant identity — its own instructions, voice, avatar, default provider/model, conversation starters, and self-managed memory.

- **Data:** `bots` (instructions, `tagline`, `modus_operandi`, `tone_of_voice`, `auto_memory`, `mood_enabled`/`mood`, `starters`, avatar, default provider/model), `bot_memory` (with `source` = `user` | `auto`), `threads.bot_id`, `messages.bot_id` (per-message attribution for @-mentions). Migrations `013`–`019`. Store: `src/store/bots.ts`.
- **Self-managed memory** (`src/lib/personaMemory.ts`): after an exchange, an off-path call to the thread's model reviews the persona's current memory and returns strict JSON (`{add, update, delete, mood}`), capped (≤3 new memories/turn, 300 chars each, 120 for mood). Auto-written rows are tagged `source: 'auto'`; user-added are `'user'`. The persona's instructions + recent memory + current mood are injected into chat context.
