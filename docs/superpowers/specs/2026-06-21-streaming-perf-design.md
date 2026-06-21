# Streaming Performance Fix — Design Spec

**Date:** 2026-06-21  
**Status:** Approved  
**Scope:** Eliminate main-thread blocking during LLM streaming, especially under planner orchestration.

---

## Problem

Every LLM token (~5 ms apart) triggers a `set()` call that clones the entire `messages` array via `.map()`. Under planner orchestration, with multiple sequential streams (planning, critiquing, revising, step execution), this produces thousands of full-array clones, starving the JS event loop and freezing the UI. The post-stream DB writes are also sequential (one `await` per attachment), adding unnecessary IPC round-trips.

### Root causes (ranked)

| Priority | Issue | Location |
|---|---|---|
| **HIGH** | `onDelta` fires `set()` on every token, recreating the full `messages` array | `store/threads.ts`: `runReply` onDelta, planner onDelta, `writeReply` onDelta, step executor onDelta, regenerate onDelta, requestSources onDelta |
| **HIGH** | Sequential DB writes after stream completes (one `await` per attachment/usage/reload) | `store/threads.ts` lines 1887–1951, 1261–1305, 1343–1360, 1573–1630 |
| **MEDIUM** | `take_screenshot` has 150 ms `std::thread::sleep` + blocking process | `commands/quick.rs:143` |
| **MEDIUM** | `ollama_unload` blocks with `std::process::Command::output()` | `commands/ollama.rs:113` |
| **MEDIUM** | Keychain commands are not async | `commands/keys.rs:71,88,121` |

---

## Design

### 1. Separate streaming state from `messages[]`

Instead of the streaming placeholder living inside the `messages` array (with `id: "__streaming__"`), give it dedicated store fields. During streaming, `messages` stays completely untouched — no array cloning, no iteration.

**New store fields** (`store/threads.ts`, `ThreadsState`):

```ts
streamingContent: string | null;      // null = no active stream
streamingToolCalls: MessageToolCall[];
streamingSubagents: MessageSubagent[];
streamingImages: MessageImage[];
streamingReasoning: string;
streamingApiTrace: ApiTraceEntry[];
streamingBotId: string | null;
streamingProvider: Provider | null;
streamingModel: string | null;
```

All cleared to defaults (null / empty arrays) when streaming starts and ends.

### 2. Throttled `set()` via timestamp check

Each `onDelta` callback writes to mutable closure refs and throttles `set()` to at most every 100 ms.

```ts
let streamAcc = "";
let lastFlush = 0;

const onDelta = (event: StreamEvent) => {
  // 1. Fast mutable accumulation (no store interaction)
  if (event.text) streamAcc += event.text;
  applyToolEvent(event, streamToolCalls);
  applySubagentEvent(event, streamSubagents);
  // ... etc

  // 2. Throttled store flush (100ms minimum gap)
  const now = performance.now();
  if (now - lastFlush > 100) {
    lastFlush = now;
    set({
      streamingContent: streamAcc,
      streamingToolCalls: [...streamToolCalls],
      streamingSubagents: [...streamSubagents],
      streamingImages: [...streamImages],
      streamingReasoning,
      streamingApiTrace: [...streamApiTrace],
    });
  }
};
```

A **final flush** after `chatStream` resolves captures trailing tokens (no throttle — pushes the complete text unconditionally).

### 3. MessageList renders the streaming bubble

```tsx
// Before: checks s.messages for STREAM_ID
// After: reads streamingContent separately
const streamingContent = useThreads(s => s.streamingContent);
// ...
{streamingContent !== null && (
  <StreamingBubble
    content={streamingContent}
    toolCalls={s.streamingToolCalls}
    subagents={s.streamingSubagents}
    // ...
  />
)}
{/* Normal messages render unchanged */}
{s.messages.map(m => <Message key={m.id} ... />)}
```

### 4. Post-stream DB batching

Group independent `addAttachment` calls into `Promise.all`. Sequential only where a dependency exists.

```ts
// After chatStream resolves, before clearing streaming state:
const msg = await addMessage({ thread_id: tid, role: "assistant", content: result.content, ... });

// Independent writes — fire together:
await Promise.all([
  ...toolCalls.map(tc => addAttachment({ message_id: msg.id, kind: "tool_call", ... })),
  ...subagents.map(s => addAttachment({ message_id: msg.id, kind: "subagent", ... })),
  ...images.map(img => addAttachment({ message_id: msg.id, kind: "image", ... })),
  persistTransparency(msg.id, reasoning, apiTrace),
]);

// Sequential — depends on attachments above being done:
await addUsage({ message_id: msg.id, ... });

// Final reload — depends on all writes above:
const msgs = await loadThreadMessages(id);
set({ messages: msgs, streamingContent: null, ... });
```

### 5. Rust command async fixes

Three commands made async:

| Command | Change |
|---|---|
| `ollama_unload` | `std::process::Command::output()` → `tokio::process::Command::output().await` |
| `take_screenshot` | `std::thread::sleep(150ms)` → `tokio::time::sleep().await`; blocking process calls become async |
| `set_api_key / has_api_key / delete_api_key` | Wrap `keyring::Entry` calls in `tokio::task::spawn_blocking()` |

---

## Edge Cases

| Case | Handling |
|---|---|
| **Cancel mid-stream** | Final flush + clear all `streaming*` fields in `finally` block, then DB reload restores partial text. |
| **Thread switch during stream** | Clear `streaming*` fields in `selectThread`. The background stream's `onDelta` already guards on `currentThreadId`; when switching back, `loadThreadMessages` restores the partial or completed message from DB. |
| **Window blur / background streaming** | No change needed — streaming continues, `runningStreams` prevents concurrent sends on the same thread. |
| **Planner multi-step** | Each step creates its own `STREAM_STEP_PREFIX` placeholder. Now each step gets its own `streamingContent` entry. Since steps run in waves, only one step per wave streams text — the streaming state reflects whichever step currently has text. |
| **Simultaneous @-mentions** | Mentions run sequentially per current design — no change. |
| **Regeneration / requestSources** | Same pattern — separate `streamingContent` field. These block parallel sends via `runningStreams`, so no collision. |

---

## What does NOT change

- The `messages` array shape — `MessageView` stays identical
- The `Message` and `MessageList` components — only the streaming placeholder reading moves from `messages` to the new fields
- The `chatStream` function — same Channel API, same call shape
- The `STREAM_ID` constant — removed after migration; the few render checks that reference it switch to `streamingContent !== null`
- `savedMessages` / thread-switch save-restore — still works for DB-persisted messages; streaming state is transient and doesn't need saving (the background stream finishes, persists to DB, and the next `loadThreadMessages` picks it up)

---

## Verification

1. Send a normal chat message — text streams smoothly, no UI freeze
2. Send a planner task ("Write a comprehensive guide to...") — UI remains responsive during planning, critiquing, step execution
3. Cancel mid-stream — partial text is persisted and shown
4. Switch threads during streaming — background stream completes, unread indicator appears, switching back shows the full message
5. Screenshot capture — no 150 ms hang
6. Ollama model unload — no blocking delay in the UI

Post-implementation: `npm run typecheck` + `cargo clippy` must pass.
