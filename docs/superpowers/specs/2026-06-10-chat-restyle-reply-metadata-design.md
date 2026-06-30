> 📐 **Historical design doc.** A dated, point-in-time design record — kept for the
> rationale, not as current truth. For how the feature works today,
> [`AGENTS.md`](../../../AGENTS.md) is canonical; where this doc and the code disagree,
> the code wins.

# Chat restyle + reply metadata

**Date:** 2026-06-10
**Status:** Approved (design)

## Goal

A set of chat-UI design changes:

1. Model replies should not render inside a chat bubble/box — only user input keeps a box.
2. Remove the provider/model subtitle line from sidebar thread rows.
3. Show a small, human-readable **relative** timestamp under each assistant reply.
4. Show a small **duration** ("how long the answer took to write") next to that timestamp.

## Decisions (locked)

- **Timer storage:** persisted to the DB (survives reload), via a new `duration_ms`
  column on `messages`. Matches the existing usage-tracking pattern.
- **Measurement:** total wall-clock from when the user hits send to when the stream
  finishes (`Date.now()` captured before `chatStream`, difference stored on the
  persisted assistant row, rounded to whole ms).
- **Timestamp scope:** assistant replies only. User input bubbles stay clean.
- **Timestamp format:** relative ("just now", "2m ago", "3h ago", "2d ago"), with the
  absolute local time available as a hover tooltip. Falls back to an absolute date for
  messages older than the relative buckets.

## Components & changes

### 1. Boxless assistant replies — `src/components/chat/MessageList.tsx`

Currently every message renders in a rounded bubble: `bg-primary` (user, right-aligned)
or `bg-muted` (assistant, left-aligned), both `rounded-lg px-3 py-2 max-w-[80%]`.

- **User** messages: unchanged (keep the box).
- **Assistant** messages: plain, left-aligned prose — no background, no rounding, no
  bubble padding, and no boxing width cap (read like a document). Images and tool-call
  chips still render above the text.
- **"Thinking…" pending indicator:** drop its box too (plain muted text, left-aligned)
  for consistency.
- The search-jump flash highlight (`flashId` ring) wraps the assistant content block as
  before; acceptable without a background.

### 2. Sidebar subtitle removal — `src/components/sidebar/ThreadRow.tsx`

Remove the second line under each thread title (the `providerLabel(thread.provider)`
`<div>`). The title button becomes single-line. Remove the now-unused `providerLabel`
helper and the `PROVIDERS` import.

### 3 + 4. Persisted duration + meta line

**Persistence**

- New migration `src-tauri/migrations/008_message_duration.sql`:
  `ALTER TABLE messages ADD COLUMN duration_ms INTEGER;` (nullable). Never edit a shipped
  migration; this is additive.
- Register it in `migrations()` in `src-tauri/src/lib.rs` as `version = 8`
  (`include_str!`).
- `Message` type (`src/types/db.ts`): add `duration_ms: number | null`.
- `addMessage` (`src/lib/db.ts`): accept an optional `duration_ms`; include the column in
  the INSERT when provided (defaults to NULL otherwise). `SELECT *` already round-trips
  the new column.

**Measuring** — `src/store/threads.ts` `send()`

- Capture `const started = Date.now()` immediately before `await chatStream(...)`.
- After the stream resolves, when persisting the assistant row, pass
  `duration_ms: Math.round(Date.now() - started)`.
- Synthetic notes via `postNote()` and any non-`send` paths leave `duration_ms` NULL.

**Formatting** — new `src/lib/time.ts`

- `parseDbTime(s: string): Date` — parse the SQLite UTC `"YYYY-MM-DD HH:MM:SS"` string as
  UTC (the string has no timezone marker; naive `new Date(s)` would treat it as local and
  be off by the local offset). Implementation: normalize to ISO-with-`Z`.
- `relativeTime(date: Date, now?: Date): string` — buckets: `< 45s` → "just now";
  `< 60m` → "Nm ago"; `< 24h` → "Nh ago"; `< 7d` → "Nd ago"; otherwise an absolute local
  date string.
- `formatDuration(ms: number): string` — `< 60s` → one decimal seconds ("4.2s");
  otherwise "Nm Ss".

**Rendering** — `src/components/chat/MessageList.tsx`

- Under each assistant reply with a non-empty `created_at`, render a meta line:
  `text-muted-foreground text-xs`, left-aligned, showing `relativeTime(created_at)` and,
  when `duration_ms` is set, `· {formatDuration(duration_ms)}`. The line's `title`
  attribute is the absolute local timestamp.
- A lightweight `setInterval` (30s) in `MessageList` updates a `now` state so relative
  times stay current without per-message timers.

## Graceful edge cases

- **Streaming placeholder** (`STREAM_ID`, empty `created_at`, no duration): no meta line
  until the persisted row replaces it.
- **Pre-migration assistant rows** (`duration_ms` NULL): timestamp only, no `· 4.2s`.
- **`postNote` synthetic notes** (NULL duration): timestamp only.
- **Cancelled/partial replies**: still persisted with a send→cancel duration — fine.

## Testing

- Unit tests for `src/lib/time.ts`:
  - `parseDbTime` returns the correct UTC instant (not shifted by local offset).
  - `relativeTime` hits each bucket boundary correctly.
  - `formatDuration` for sub-minute (one decimal) and multi-minute cases.
- The visual changes (boxless replies, sidebar subtitle removal, meta-line placement) are
  verified by running the app.

## Files

- New: `src-tauri/migrations/008_message_duration.sql`
- New: `src/lib/time.ts` (+ `src/lib/time.test.ts`)
- Edit: `src-tauri/src/lib.rs` (register migration v8)
- Edit: `src/types/db.ts` (`Message.duration_ms`)
- Edit: `src/lib/db.ts` (`addMessage` accepts `duration_ms`)
- Edit: `src/store/threads.ts` (measure + persist duration)
- Edit: `src/components/chat/MessageList.tsx` (boxless assistant, meta line, now-ticker)
- Edit: `src/components/sidebar/ThreadRow.tsx` (remove provider subtitle)
