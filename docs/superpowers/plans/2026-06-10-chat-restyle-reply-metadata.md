# Chat restyle + reply metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make model replies render as boxless prose, drop the provider subtitle from sidebar rows, and show a small relative timestamp + generation duration under each assistant reply.

**Architecture:** Pure time-formatting helpers (`src/lib/time.ts`, unit-tested) feed a meta line in `MessageList`. Generation duration is measured in the Zustand store's `send()` (wall-clock send→finish) and persisted to a new nullable `messages.duration_ms` column (migration 008) via `addMessage`, so it survives reload like token usage already does. The remaining changes are presentational (Tailwind class swaps in `MessageList` and `ThreadRow`).

**Tech Stack:** React 19 + TypeScript, Tailwind v4, Zustand, Vitest, Tauri SQL plugin (Rust-registered migrations).

**Spec:** `docs/superpowers/specs/2026-06-10-chat-restyle-reply-metadata-design.md`

---

### Task 1: Time-formatting helpers (`src/lib/time.ts`)

Pure functions: parse the SQLite UTC timestamp string correctly, format a relative
"… ago" label, and format a duration. TDD — these are the only unit-testable units.

**Files:**
- Create: `src/lib/time.ts`
- Test: `src/lib/time.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatDuration, parseDbTime, relativeTime } from "@/lib/time";

describe("parseDbTime", () => {
  it("parses a SQLite UTC string as UTC, not local time", () => {
    // No timezone marker in the DB string; must be treated as UTC.
    expect(parseDbTime("2026-06-10 14:32:05").toISOString()).toBe(
      "2026-06-10T14:32:05.000Z",
    );
  });
});

describe("relativeTime", () => {
  const base = new Date("2026-06-10T12:00:00Z");
  const ago = (ms: number) => relativeTime(new Date(base.getTime() - ms), base);

  it("says 'just now' under 45s", () => {
    expect(ago(10_000)).toBe("just now");
  });
  it("rounds the 45-60s gap up to 1m", () => {
    expect(ago(50_000)).toBe("1m ago");
  });
  it("formats minutes", () => {
    expect(ago(5 * 60_000)).toBe("5m ago");
  });
  it("formats hours", () => {
    expect(ago(2 * 3_600_000)).toBe("2h ago");
  });
  it("formats days", () => {
    expect(ago(3 * 86_400_000)).toBe("3d ago");
  });
  it("falls back to an absolute date past 7 days", () => {
    const old = new Date(base.getTime() - 10 * 86_400_000);
    expect(relativeTime(old, base)).toBe(old.toLocaleDateString());
  });
  it("treats future timestamps as 'just now' (clock skew)", () => {
    expect(relativeTime(new Date(base.getTime() + 5_000), base)).toBe(
      "just now",
    );
  });
});

describe("formatDuration", () => {
  it("uses one-decimal seconds under a minute", () => {
    expect(formatDuration(4200)).toBe("4.2s");
    expect(formatDuration(500)).toBe("0.5s");
  });
  it("uses Nm Ss at a minute and above", () => {
    expect(formatDuration(60_000)).toBe("1m 0s");
    expect(formatDuration(83_000)).toBe("1m 23s");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/time.test.ts`
Expected: FAIL — cannot resolve `@/lib/time` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/time.ts`:

```ts
// Time formatting for chat reply metadata. `created_at` comes from SQLite as a
// UTC "YYYY-MM-DD HH:MM:SS" string with no timezone marker (see src/lib/db.ts),
// so it must be parsed as UTC — naive `new Date(s)` would treat it as local
// time and be off by the local offset.

/** Parse a SQLite "YYYY-MM-DD HH:MM:SS" UTC timestamp into a Date. */
export function parseDbTime(s: string): Date {
  return new Date(`${s.replace(" ", "T")}Z`);
}

/** Human-readable "… ago" label; absolute date once older than 7 days. */
export function relativeTime(date: Date, now: Date = new Date()): string {
  const sec = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (sec < 45) return "just now";
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 7 * 86400) return `${Math.floor(sec / 86400)}d ago`;
  return date.toLocaleDateString();
}

/** Format a duration in ms: "4.2s" under a minute, "1m 23s" at/above. */
export function formatDuration(ms: number): string {
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSec = Math.round(ms / 1000);
  return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/time.test.ts`
Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/time.ts src/lib/time.test.ts
git commit -m "feat: time helpers for relative timestamps and durations"
```

---

### Task 2: Persist per-reply duration end-to-end

Add the `duration_ms` column, thread it through the type and `addMessage`, and measure
+ store wall-clock generation time in the store's `send()`. Not unit-tested (DB + store
integration) — verified by the Rust and TypeScript builds, then manually in Task 3.

**Files:**
- Create: `src-tauri/migrations/008_message_duration.sql`
- Modify: `src-tauri/src/lib.rs:98-104` (register migration v8)
- Modify: `src/types/db.ts:48-54` (`Message.duration_ms`)
- Modify: `src/lib/db.ts:154-172` (`addMessage` accepts `duration_ms`)
- Modify: `src/store/threads.ts` (placeholder literal + measure/persist in `send()`)

- [ ] **Step 1: Add the migration file**

Create `src-tauri/migrations/008_message_duration.sql`:

```sql
-- Per-assistant-reply generation time in milliseconds. Nullable: pre-existing
-- rows, user messages, and synthetic notes have no duration.
ALTER TABLE messages ADD COLUMN duration_ms INTEGER;
```

- [ ] **Step 2: Register the migration in Rust**

In `src-tauri/src/lib.rs`, inside `migrations()`, add a new entry immediately after the
`version: 7` block (before the closing `]` on line 104):

```rust
        Migration {
            version: 8,
            description: "message duration: per-assistant-reply generation time in ms",
            sql: include_str!("../migrations/008_message_duration.sql"),
            kind: MigrationKind::Up,
        },
```

- [ ] **Step 3: Add `duration_ms` to the `Message` type**

In `src/types/db.ts`, update the `Message` interface (currently lines 48-54):

```ts
export interface Message {
  id: string;
  thread_id: string;
  role: Role;
  content: string;
  /** Wall-clock generation time in ms for assistant replies; null otherwise. */
  duration_ms: number | null;
  created_at: string;
}
```

- [ ] **Step 4: Accept `duration_ms` in `addMessage`**

In `src/lib/db.ts`, replace the `addMessage` function (lines 154-172) with:

```ts
export async function addMessage(input: {
  thread_id: string;
  role: Role;
  content: string;
  duration_ms?: number | null;
}): Promise<Message> {
  const db = await getDb();
  const id = newId();
  await db.execute(
    `INSERT INTO messages (id, thread_id, role, content, duration_ms)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, input.thread_id, input.role, input.content, input.duration_ms ?? null],
  );
  await touchThread(input.thread_id);
  const rows = await db.select<Message[]>(
    `SELECT * FROM messages WHERE id = $1`,
    [id],
  );
  return rows[0];
}
```

- [ ] **Step 5: Add `duration_ms: null` to the streaming placeholder**

In `src/store/threads.ts`, the `onDelta` handler builds an in-memory placeholder message
(the object literal beginning `id: STREAM_ID`). Add `duration_ms: null` to it so it
satisfies the now-required field. The literal becomes:

```ts
                {
                  id: STREAM_ID,
                  thread_id: id!,
                  role: "assistant" as const,
                  content: "",
                  duration_ms: null,
                  created_at: "",
                  images: [],
                  toolCalls: [],
                },
```

- [ ] **Step 6: Measure and persist the duration in `send()`**

In `src/store/threads.ts`, add a start timestamp immediately before the `chatStream`
call. The line is currently:

```ts
      const result = await chatStream(provider, model, history, onDelta);
```

Replace it with:

```ts
      const started = Date.now();
      const result = await chatStream(provider, model, history, onDelta);
```

Then, in the same function, the assistant row is persisted via `addMessage`. Change that
call from:

```ts
        const assistantMsg = await addMessage({
          thread_id: id,
          role: "assistant",
          content: result.content,
        });
```

to:

```ts
        const assistantMsg = await addMessage({
          thread_id: id,
          role: "assistant",
          content: result.content,
          duration_ms: Math.round(Date.now() - started),
        });
```

- [ ] **Step 7: Verify the Rust build (migration compiles + embeds)**

Run from `src-tauri/`: `cargo build`
Expected: builds successfully (the `include_str!` path resolves to the new file).

- [ ] **Step 8: Verify the TypeScript build**

Run: `npm run build`
Expected: `tsc` passes (placeholder satisfies the required `duration_ms`; `addMessage`
signature consistent) and the Vite build completes.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/migrations/008_message_duration.sql src-tauri/src/lib.rs \
        src/types/db.ts src/lib/db.ts src/store/threads.ts
git commit -m "feat: persist per-reply generation duration"
```

---

### Task 3: Boxless assistant replies + meta line (`MessageList.tsx`)

User messages keep their bubble; assistant replies render as plain left-aligned prose
with a `relativeTime · duration` meta line underneath. A 30s ticker keeps relative times
fresh. Verified by build + lint + running the app.

**Files:**
- Modify: `src/components/chat/MessageList.tsx`

- [ ] **Step 1: Import the time helpers**

At the top of `src/components/chat/MessageList.tsx`, add below the existing imports:

```ts
import { formatDuration, parseDbTime, relativeTime } from "@/lib/time";
```

- [ ] **Step 2: Add the assistant meta-line component**

Add this component near `ToolCallChip` (above `MessageList`):

```tsx
/** Small footer under an assistant reply: relative time + generation duration.
 * Hidden for the streaming placeholder (empty created_at). `now` is supplied by
 * the parent's ticker so the relative label stays current. */
function AssistantMeta({
  createdAt,
  durationMs,
  now,
}: {
  createdAt: string;
  durationMs: number | null;
  now: number;
}) {
  if (!createdAt) return null;
  const date = parseDbTime(createdAt);
  return (
    <div className="text-muted-foreground text-xs" title={date.toLocaleString()}>
      {relativeTime(date, new Date(now))}
      {durationMs != null && ` · ${formatDuration(durationMs)}`}
    </div>
  );
}
```

- [ ] **Step 3: Add the now-ticker**

Inside `MessageList`, after the existing `useState`/`useRef` declarations (just before
the scroll `useEffect`), add:

```tsx
  // Drives re-render of relative timestamps so "2m ago" advances on its own.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
```

- [ ] **Step 4: Make the message container boxless for assistant**

Replace the inner message `<div>` (currently the block with
`"flex max-w-[80%] flex-col gap-2 rounded-lg px-3 py-2 text-sm transition-shadow"` and the
user/assistant background branch) with:

```tsx
          <div
            className={cn(
              "flex flex-col gap-2 text-sm",
              m.role === "user"
                ? "bg-primary text-primary-foreground max-w-[80%] rounded-lg px-3 py-2"
                : "text-foreground w-full max-w-full",
              flashId === m.id && "ring-primary rounded-lg ring-2 ring-offset-2",
            )}
          >
```

- [ ] **Step 5: Render the meta line under assistant content**

Immediately after the content block (the `{m.content && ( … )}` expression, before the
closing `</div>` of the inner message container), add:

```tsx
            {m.role === "assistant" && (
              <AssistantMeta
                createdAt={m.created_at}
                durationMs={m.duration_ms}
                now={now}
              />
            )}
```

- [ ] **Step 6: Make the "Thinking…" indicator boxless**

Replace the pending block:

```tsx
      {pending && (
        <div className="flex justify-start">
          <div className="bg-muted text-muted-foreground rounded-lg px-3 py-2 text-sm">
            Thinking…
          </div>
        </div>
      )}
```

with:

```tsx
      {pending && (
        <div className="flex justify-start">
          <div className="text-muted-foreground text-sm">Thinking…</div>
        </div>
      )}
```

- [ ] **Step 7: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: both pass with no errors.

- [ ] **Step 8: Verify visually**

Run: `npm run tauri dev`. Send a message. Confirm: your message sits in a right-aligned
box; the reply is plain left-aligned text with no box; a small `… ago · N.Ns` line shows
under the reply; the "Thinking…" indicator has no box. Reopen the thread and confirm the
timestamp **and** duration persist.

- [ ] **Step 9: Commit**

```bash
git add src/components/chat/MessageList.tsx
git commit -m "feat: boxless assistant replies with timestamp + duration meta"
```

---

### Task 4: Remove the provider subtitle from sidebar rows (`ThreadRow.tsx`)

Drop the second line under each thread title and the now-dead helper/imports.

**Files:**
- Modify: `src/components/sidebar/ThreadRow.tsx`

- [ ] **Step 1: Remove the subtitle line**

In `src/components/sidebar/ThreadRow.tsx`, the title button currently renders two lines:

```tsx
          <div className="truncate text-sm">{thread.title}</div>
          <div className="text-muted-foreground truncate text-xs">
            {providerLabel(thread.provider)}
          </div>
```

Replace that with just the title line:

```tsx
          <div className="truncate text-sm">{thread.title}</div>
```

- [ ] **Step 2: Remove the now-unused helper**

Delete the `providerLabel` helper and its leading comment (currently lines 10-13):

```tsx
// A thread's provider label for the row subtitle. Uses the static registry
// (all four providers) so the label resolves even for a since-disabled provider.
const providerLabel = (p: Provider) =>
  PROVIDERS.find((x) => x.id === p)?.label ?? p;
```

- [ ] **Step 3: Remove the now-unused imports**

Delete the `PROVIDERS` import line:

```tsx
import { PROVIDERS } from "@/lib/providers";
```

And narrow the db types import (drop `Provider`, keep `Thread`):

```tsx
import type { Thread } from "@/types/db";
```

- [ ] **Step 4: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: both pass — no unused-variable/import errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/ThreadRow.tsx
git commit -m "feat: drop provider subtitle from sidebar thread rows"
```

---

## Self-Review

**Spec coverage:**
- Boxless model replies → Task 3 (Steps 4, 6). ✓
- Only input keeps a box → Task 3 (Step 4, user branch retains bubble). ✓
- Remove sidebar provider/model subtitle → Task 4. ✓
- Relative timestamp on each reply → Task 1 (`relativeTime`) + Task 3 (Steps 2, 5). ✓
- Duration timer, persisted → Task 1 (`formatDuration`) + Task 2 (column + measure) + Task 3 (render). ✓
- UTC parsing correctness → Task 1 (`parseDbTime` + test). ✓
- Graceful NULL duration / empty created_at → Task 3 (`AssistantMeta` guards on empty `createdAt`; `durationMs != null` gate). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has expected output. ✓

**Type consistency:** `Message.duration_ms: number | null` (Task 2 Step 3) matches `addMessage`'s `duration_ms?: number | null` (Step 4), the placeholder's `duration_ms: null` (Step 5), and `AssistantMeta`'s `durationMs: number | null` prop (Task 3 Step 2). Helper names `parseDbTime` / `relativeTime` / `formatDuration` are identical across Task 1's definition, its tests, and Task 3's import. ✓
