# Streaming Performance Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate main-thread blocking during LLM streaming by moving streaming state out of the `messages[]` array and into dedicated throttled store fields, batching post-stream DB writes, and making three Rust commands async.

**Architecture:** Streaming placeholder text, tool calls, subagents, images, reasoning, and API trace move from mutable `STREAM_ID` entries inside the Zustand `messages[]` array into dedicated `streamingContent` / `streamingToolCalls` / etc. store fields. These fields are updated at most every 100ms (timestamp throttle), so the `messages` array stays stable — no `.map()` clones per token. The Virtuoso `data` is a computed `displayItems` array that appends a synthetic `MessageView` when `streamingContent !== null`. Post-stream DB writes are grouped into `Promise.all` where independent. Three Rust commands are made async.

**Tech Stack:** TypeScript, React 19, Zustand, Tauri v2, Rust with Tokio

## Global Constraints

- `npm run typecheck` and `cargo clippy` must pass after all changes.
- No changes to the `MessageView` type shape or the `chatStream` / `Channel` API.
- The Virtuoso virtual-list rendering must stay smooth — streaming bubble insertion must not cause scroll jumps.
- All existing features (planner, regenerate, requestSources, @-mentions, cancel, thread-switch-during-stream) must keep working.

---

### Task 1: Add streaming state fields to the store

**Files:**
- Modify: `src/store/threads.ts`: interface + initial defaults

**Interfaces:**
- Produces: `ThreadsState` gains `streamingContent`, `streamingToolCalls`, `streamingSubagents`, `streamingImages`, `streamingReasoning`, `streamingApiTrace`, `streamingBotId`, `streamingProvider`, `streamingModel`

- [ ] **Step 1: Add fields to `ThreadsState` interface**

In `src/store/threads.ts`, after the `error: string | null` field (around line 284), add:

```ts
  /** Live streaming placeholder text (null = no active stream). Updated at most
   *  every 100ms during streaming. The messages array is untouched — the
   *  rendering layer augments displayItems with this. */
  streamingContent: string | null;
  streamingToolCalls: MessageToolCall[];
  streamingSubagents: MessageSubagent[];
  streamingImages: MessageImage[];
  streamingReasoning: string;
  streamingApiTrace: ApiTraceEntry[];
  streamingBotId: string | null;
  streamingProvider: Provider | null;
  streamingModel: string | null;
```

- [ ] **Step 2: Add initial defaults to `create<ThreadsState>` call**

In the initial state object passed to `create<ThreadsState>((set, get) => ({` (around line 608), add after `error: null,`:

```ts
  streamingContent: null,
  streamingToolCalls: [],
  streamingSubagents: [],
  streamingImages: [],
  streamingReasoning: "",
  streamingApiTrace: [],
  streamingBotId: null,
  streamingProvider: null,
  streamingModel: null,
```

- [ ] **Step 3: Run typecheck to confirm no breakage yet**

Run: `npm run build` (which typechecks)
Expected: PASS — no consumers use these fields yet.

- [ ] **Step 4: Commit**

```bash
git add src/store/threads.ts
git commit -m "Add streaming state fields to ThreadsState"
```

---

### Task 2: Refactor `runReply` — streaming state + throttle + batching

**Files:**
- Modify: `src/store/threads.ts`: `runReply` closure (lines 1707–1953)

**Interfaces:**
- Consumes: `streamingContent` fields from Task 1
- Produces: `runReply` uses `streamingContent` instead of `STREAM_ID` in messages

- [ ] **Step 1: Add streaming-state init at top of `runReply`**

Replace the stream start near line 1707 (before `let acc = ""`). The `runReply` function already has `const onDelta = (event: StreamEvent) => { ... }`. We need to:
1. Remove the `let acc = ""` (and similar accumulators — toolCalls, subagents, etc. stay but are now part of the throttled flush)
2. Add a streaming-state initial `set()` call right after `runReply`'s `history` is assembled and before `chatStream` is called.

In `runReply`, right after `const history: ApiMessage[] = [...]` (line 1754) and before the `const onDelta = ...` (line 1773), insert:

```ts
        // Seed streaming state so the render layer shows the bubble immediately
        // (empty string — the "Thinking…" spinner hides on the first token).
        set({
          streamingContent: "",
          streamingToolCalls: [],
          streamingSubagents: [],
          streamingImages: [],
          streamingReasoning: "",
          streamingApiTrace: [],
          streamingBotId: attributeBotId,
          streamingProvider: replyProvider,
          streamingModel: replyModel,
        });
```

- [ ] **Step 2: Rewrite the `onDelta` with throttle**

Replace lines 1761–1854 (`let acc = "";` through the closing `};` of onDelta) with:

```ts
        let streamAcc = "";
        const toolCalls: MessageToolCall[] = [];
        const subagents: MessageSubagent[] = [];
        const foundImages: MessageImage[] = [];
        let reasoning = "";
        const apiTrace: ApiTraceEntry[] = [];
        let lastFlush = 0;
        const flushStreamingState = () => {
          set({
            streamingContent: streamAcc,
            streamingToolCalls: [...toolCalls],
            streamingSubagents: [...subagents],
            streamingImages: [...foundImages],
            streamingReasoning: reasoning,
            streamingApiTrace: [...apiTrace],
            ...(streamAcc.length > 0 ? { awaitingModel: false } : {}),
          });
        };
        const onDelta = (event: StreamEvent) => {
          if (event.approvalRequest) {
            const req = event.approvalRequest;
            if (get().autoApproveSysTools) {
              void approveToolCall(req.id, true);
            } else {
              set({ pendingApproval: req });
            }
            return;
          }
          applyToolEvent(event, toolCalls);
          applySubagentEvent(event, subagents);
          applyTraceEvent(event, apiTrace);
          if (event.reasoning) reasoning += event.reasoning.text;
          if (event.toolImages) {
            for (const img of event.toolImages.images) {
              foundImages.push({
                media_type: img.mediaType,
                data: img.data,
                source: img.sourceUrl,
                title: img.title,
              });
            }
          }
          if (event.text) streamAcc += event.text;
          // After a tool/subagent event, show "Thinking…" until the next text
          // token arrives.
          if (event.toolDone || event.subagent) set({ awaitingModel: true });
          // Throttle: push to store at most every 100ms.
          const now = performance.now();
          if (now - lastFlush > 100) {
            lastFlush = now;
            flushStreamingState();
          }
        };
```

- [ ] **Step 3: Add final flush after `chatStream` resolves**

After `const result = await chatStream(...)` (line 1867), insert a final flush:

```ts
        // Final flush — push any trailing tokens that arrived within the last
        // 100ms window, unfiltered.
        flushStreamingState();
```

- [ ] **Step 4: Replace the post-stream persistence with batched writes**

Replace lines 1871–1943 (the `if (result.content.length > 0 || ...)` block through the usage persistence) with:

```ts
        if (
          result.content.length > 0 ||
          toolCalls.length > 0 ||
          subagents.length > 0 ||
          foundImages.length > 0
        ) {
          const assistantMsg = await addMessage({
            thread_id: threadId,
            role: "assistant",
            content: result.content,
            duration_ms: Math.round(Date.now() - started),
            bot_id: attributeBotId,
          });
          // Batch independent attachment writes.
          await Promise.all([
            ...toolCalls.map((tc) =>
              addAttachment({
                message_id: assistantMsg.id,
                kind: "tool_call",
                media_type: "application/json",
                data: JSON.stringify(persistableToolCall(tc)),
              }),
            ),
            ...subagents.map((s) =>
              addAttachment({
                message_id: assistantMsg.id,
                kind: "subagent",
                media_type: "application/json",
                data: JSON.stringify(persistableSubagent(s)),
              }),
            ),
            ...foundImages.map((img) =>
              addAttachment({
                message_id: assistantMsg.id,
                kind: "image",
                media_type: img.media_type,
                data: img.data,
                filename: img.source,
              }),
            ),
            persistTransparency(assistantMsg.id, reasoning, apiTrace),
          ]);
          // Usage depends on the persisted message (needs message_id).
          const u = result.usage;
          if (
            u &&
            (u.input_tokens > 0 ||
              u.output_tokens > 0 ||
              u.cache_creation_tokens > 0 ||
              u.cache_read_tokens > 0)
          ) {
            await addUsage({
              message_id: assistantMsg.id,
              thread_id: threadId,
              provider: replyProvider,
              model: result.model || replyModel,
              input_tokens: u.input_tokens,
              output_tokens: u.output_tokens,
              cache_creation_tokens: u.cache_creation_tokens,
              cache_read_tokens: u.cache_read_tokens,
            });
          }
        }
```

- [ ] **Step 5: Replace the final reload + cleanup**

Replace lines 1945–1951 (the `loadThreadMessages` + `refreshThreads` block) with:

```ts
        // Clear streaming state and reload persisted messages.
        set({
          streamingContent: null,
          streamingToolCalls: [],
          streamingSubagents: [],
          streamingImages: [],
          streamingReasoning: "",
          streamingApiTrace: [],
          streamingBotId: null,
          streamingProvider: null,
          streamingModel: null,
        });
        {
          const msgs = await loadThreadMessages(threadId);
          if (get().currentThreadId === threadId) set({ messages: msgs });
        }
      await get().refreshThreads();
```

- [ ] **Step 6: Remove the `result` return (not needed)**

Remove `return result;` at the end of `runReply` (line 1952) since callers don't use the return value directly anymore (the `reviewExchange` call at line 1991 reads `result.content` — keep just `const result` assignment).

- [ ] **Step 7: Update `reviewExchange` call site**

At lines 1991 and 1997, `const result = await runReply(bot, null)` still works because `runReply` returns `result` (we didn't remove the return). But `reviewExchange` reads `result.content`. Leave this as-is — `result` still has `content`.

- [ ] **Step 8: Add streaming-state clear to `send()` finally block**

The `send()` function's `finally` block (lines 2007–2027) clears `runningStreams`, `cancelling`, etc. but doesn't clear streaming state. On error/cancel paths, stale streaming state would linger. Add the clear inside the existing `set()` call at line 2009:

In the returned object, add after `awaitingModel: false,`:

```ts
            streamingContent: null,
            streamingToolCalls: [],
            streamingSubagents: [],
            streamingImages: [],
            streamingReasoning: "",
            streamingApiTrace: [],
            streamingBotId: null,
            streamingProvider: null,
            streamingModel: null,
```

- [ ] **Step 9: Commit**

```bash
git add src/store/threads.ts
git commit -m "Refactor runReply to use throttled streaming state"
```

---

### Task 3: Refactor planner orchestration streaming

**Files:**
- Modify: `src/store/threads.ts`: `runPlannerOrchestration` (lines 1128–1693)

**Interfaces:**
- Consumes: `streamingContent` fields from Task 1
- Produces: Planner streams use `streamingContent` instead of `STREAM_ID` in messages

- [ ] **Step 1: Replace planner's onDelta (planning phase)**

The planner's `onDelta` (lines 1168–1218) creates a `STREAM_ID` placeholder inside messages and accumulates `plannerAcc`. Replace it with the throttled streaming-state pattern. The planner stream accumulates in the same `streamingContent` field as `runReply`:

Replace lines 1162–1218 (`let plannerAcc = "";` through the closing `};` of the planner `onDelta`) with:

```ts
        // Use the global streaming state fields — they hold the planner's live
        // output during the planning phase.
        let plannerAcc = "";
        const plannerToolCalls: MessageToolCall[] = [];
        const plannerSubagents: MessageSubagent[] = [];
        let plannerReasoning = "";
        const plannerApiTrace: ApiTraceEntry[] = [];
        let plannerLastFlush = 0;
        const plannerFlush = () => {
          if (get().currentThreadId !== tid) return;
          set({
            streamingContent: plannerAcc,
            streamingToolCalls: [...plannerToolCalls],
            streamingSubagents: [...plannerSubagents],
            streamingReasoning: plannerReasoning,
            streamingApiTrace: [...plannerApiTrace],
            streamingProvider: plannerProvider,
            streamingModel: plannerModel,
            ...(isModelOutput({ text: plannerAcc } as StreamEvent) ? { awaitingModel: false } : {}),
          });
        };
        set({
          streamingContent: "",
          streamingToolCalls: [],
          streamingSubagents: [],
          streamingImages: [],
          streamingReasoning: "",
          streamingApiTrace: [],
          streamingBotId: null,
          streamingProvider: plannerProvider,
          streamingModel: plannerModel,
        });
        const onDelta = (event: StreamEvent) => {
          applyToolEvent(event, plannerToolCalls);
          applySubagentEvent(event, plannerSubagents);
          applyTraceEvent(event, plannerApiTrace);
          if (event.reasoning) plannerReasoning += event.reasoning.text;
          if (event.text) plannerAcc += event.text;
          const now = performance.now();
          if (now - plannerLastFlush > 100) {
            plannerLastFlush = now;
            plannerFlush();
          }
        };
```

- [ ] **Step 2: Replace post-planner-stream cleanup**

After `const plannerResult = await chatStream(...)` (line 1229), final flush:

```ts
        plannerFlush();
```

- [ ] **Step 3: Replace the STREAM_ID display-content update**

Lines 1246–1251 update the STREAM_ID placeholder to show cleaned content. With the new approach, we just keep the cleaned text in `streamingContent` until `loadThreadMessages` replaces it. Remove the `set(...)` call at lines 1246–1251.

- [ ] **Step 4: Replace the planner persistence + batched writes**

Replace lines 1253–1305 (the planner message persistence block) with batched writes:

```ts
          const plannerMsg = await addMessage({
            thread_id: tid,
            role: "assistant",
            content: displayContent,
            duration_ms: Math.round(Date.now() - started),
            provider: plannerProvider,
            model: plannerModel,
          });
          await Promise.all([
            ...plannerToolCalls.map((tc) =>
              addAttachment({
                message_id: plannerMsg.id,
                kind: "tool_call",
                media_type: "application/json",
                data: JSON.stringify(persistableToolCall(tc)),
              }),
            ),
            ...plannerSubagents.map((s) =>
              addAttachment({
                message_id: plannerMsg.id,
                kind: "subagent",
                media_type: "application/json",
                data: JSON.stringify(persistableSubagent(s)),
              }),
            ),
            persistTransparency(plannerMsg.id, plannerReasoning, plannerApiTrace),
          ]);
          const u = plannerResult.usage;
          if (
            u &&
            (u.input_tokens > 0 ||
              u.output_tokens > 0 ||
              u.cache_creation_tokens > 0 ||
              u.cache_read_tokens > 0)
          ) {
            await addUsage({
              message_id: plannerMsg.id,
              thread_id: tid,
              provider: plannerProvider,
              model: plannerResult.model || plannerModel,
              input_tokens: u.input_tokens,
              output_tokens: u.output_tokens,
              cache_creation_tokens: u.cache_creation_tokens,
              cache_read_tokens: u.cache_read_tokens,
            });
          }
```

- [ ] **Step 5: Replace the inner `writeReply` helper's onDelta**

The `writeReply` helper (lines 1310–1360) also creates a `STREAM_ID` placeholder. Replace its `onDelta` (lines 1321–1342) with:

```ts
              let acc = "";
              let wLastFlush = 0;
              const wFlush = () => {
                if (get().currentThreadId !== tid) return;
                set({
                  streamingContent: acc,
                  streamingProvider: provider,
                  streamingModel: model,
                });
              };
              set({
                streamingContent: "",
                streamingToolCalls: [],
                streamingSubagents: [],
                streamingImages: [],
                streamingReasoning: "",
                streamingApiTrace: [],
                streamingBotId: null,
                streamingProvider: provider,
                streamingModel: model,
              });
              const onDelta = (event: StreamEvent) => {
                if (event.text) acc += event.text;
                const now = performance.now();
                if (now - wLastFlush > 100) {
                  wLastFlush = now;
                  wFlush();
                }
              };
```

And add `wFlush();` after the `chatStream(...)` call inside `writeReply`.

Replace the `writeReply` persistence block (lines 1344–1360) with batched writes:

```ts
              if (result.content.length > 0) {
                const msg = await addMessage({
                  thread_id: tid, role: "assistant", content: result.content,
                  provider, model,
                });
                {
                  // Clear streaming, load real messages.
                  set({
                    streamingContent: null,
                    streamingToolCalls: [],
                    streamingSubagents: [],
                    streamingImages: [],
                    streamingReasoning: "",
                    streamingApiTrace: [],
                    streamingBotId: null,
                    streamingProvider: null,
                    streamingModel: null,
                  });
                  const msgs = await loadThreadMessages(tid);
                  if (get().currentThreadId === tid) set({ messages: msgs });
                }
                return { ...result, msgId: msg.id };
              }
              {
                set({
                  streamingContent: null,
                  streamingToolCalls: [],
                  streamingSubagents: [],
                  streamingImages: [],
                  streamingReasoning: "",
                  streamingApiTrace: [],
                  streamingBotId: null,
                  streamingProvider: null,
                  streamingModel: null,
                });
                const msgs = await loadThreadMessages(tid);
                if (get().currentThreadId === tid) set({ messages: msgs });
              }
```

- [ ] **Step 6: Replace the step executor — skip streaming bubble**

Steps run in parallel waves (`Promise.all`), each with its own placeholder ID originally. A single `streamingContent` field can't represent multiple simultaneous streams (they'd overwrite each other). Instead, skip the streaming bubble for step execution entirely — the planner progress strip (`threadPlannerProgress`) already shows live per-step status. Content appears only after the step persists to DB and `loadThreadMessages` picks it up.

Replace lines 1517–1561 (`const streamId = ...` through the `const stepOnDelta = ...` closure and the `chatStream` wrapper at lines 1559–1571) with:

```ts
                // No streaming bubble for steps — the planner progress strip
                // already shows live status. Content surfaces after DB reload.
                const noopOnDelta = (_event: StreamEvent) => {};
```

And change the `chatStream` call at line 1571 from:
```ts
                const stepResult = await gate(
                  isKeylessProvider(step.provider),
                  () =>
                    chatStream(
                      step.provider,
                      step.model,
                      [{ role: "user", content: resolvedPrompt, images: [] }],
                      stepOnDelta,
                      tid,
                      false,
                    ),
                );
```
to:
```ts
                const stepResult = await gate(
                  isKeylessProvider(step.provider),
                  () =>
                    chatStream(
                      step.provider,
                      step.model,
                      [{ role: "user", content: resolvedPrompt, images: [] }],
                      noopOnDelta,
                      tid,
                      false,
                    ),
                );
```

Step persistence (lines 1573–1602) already persists to DB and doesn't touch STREAM_ID directly. Keep as-is.

- [ ] **Step 7: Replace post-planner-reload** (line 1369–1372, and similar reload blocks)

The `loadThreadMessages` calls at lines 1369–1372, 1443–1446, 1673–1690 already just reload and `set({ messages: msgs })`. These are fine — they naturally replace the streaming placeholder since messages come from DB. Add streaming-state clear before each:

At line 1369 (after plan attachment save), add before `const msgs = await loadThreadMessages(tid)`:

```ts
            set({
              streamingContent: null,
              streamingToolCalls: [],
              streamingSubagents: [],
              streamingImages: [],
              streamingReasoning: "",
              streamingApiTrace: [],
              streamingBotId: null,
              streamingProvider: null,
              streamingModel: null,
            });
```

And the same before the reload at line 1676.

- [ ] **Step 8: Commit**

```bash
git add src/store/threads.ts
git commit -m "Refactor planner orchestration to use throttled streaming state"
```

---

### Task 4: Refactor `regenerate` and `requestSources` onDeltas

**Files:**
- Modify: `src/store/threads.ts`: `regenerate` (lines 2065–2342), `requestSources` (lines 2354–2625)

- [ ] **Step 1: Refactor `regenerate` onDelta**

Replace lines 2163–2240 (`let acc = "";` through the closing `};` of onDelta) with the throttled pattern. The `regenerate` function has its own local `toolCalls`, `subagents`, `foundImages`, `reasoning`, `apiTrace` accumulators — replace with the centralized streaming-state fields:

```ts
      let acc = "";
      const toolCalls: MessageToolCall[] = [];
      const subagents: MessageSubagent[] = [];
      const foundImages: MessageImage[] = [];
      let reasoning = "";
      const apiTrace: ApiTraceEntry[] = [];
      let lastFlush = 0;
      const flushStreamingState = () => {
        set({
          streamingContent: acc,
          streamingToolCalls: [...toolCalls],
          streamingSubagents: [...subagents],
          streamingImages: [...foundImages],
          streamingReasoning: reasoning,
          streamingApiTrace: [...apiTrace],
          streamingProvider: replyProvider,
          streamingModel: replyModel,
          ...(acc.length > 0 ? { awaitingModel: false } : {}),
        });
      };
      set({
        streamingContent: "",
        streamingToolCalls: [],
        streamingSubagents: [],
        streamingImages: [],
        streamingReasoning: "",
        streamingApiTrace: [],
        streamingBotId: attributeBotId,
        streamingProvider: replyProvider,
        streamingModel: replyModel,
      });
      const onDelta = (event: StreamEvent) => {
        if (event.approvalRequest) {
          const req = event.approvalRequest;
          if (get().autoApproveSysTools) {
            void approveToolCall(req.id, true);
          } else {
            set({ pendingApproval: req });
          }
          return;
        }
        applyToolEvent(event, toolCalls);
        applySubagentEvent(event, subagents);
        applyTraceEvent(event, apiTrace);
        if (event.reasoning) reasoning += event.reasoning.text;
        if (event.toolImages) {
          for (const img of event.toolImages.images) {
            foundImages.push({
              media_type: img.mediaType,
              data: img.data,
              source: img.sourceUrl,
              title: img.title,
            });
          }
        }
        if (event.text) acc += event.text;
        if (event.toolDone || event.subagent) set({ awaitingModel: true });
        const now = performance.now();
        if (now - lastFlush > 100) {
          lastFlush = now;
          flushStreamingState();
        }
      };
```

Add `flushStreamingState();` after `const result = await chatStream(...)` (line 2250).

Replace the persistence block (lines 2251–2317) with batched writes (same pattern as Task 2 Step 4).

Add streaming-state clear + reload at the end (replacing lines 2313–2317):

```ts
      set({
        streamingContent: null,
        streamingToolCalls: [],
        streamingSubagents: [],
        streamingImages: [],
        streamingReasoning: "",
        streamingApiTrace: [],
        streamingBotId: null,
        streamingProvider: null,
        streamingModel: null,
      });
      {
        const msgs = await loadThreadMessages(id);
        if (get().currentThreadId === id) set({ messages: msgs });
      }
      await get().refreshThreads();
```

- [ ] **Step 2: Refactor `requestSources` onDelta**

Same pattern as `regenerate`. Replace lines 2445–2522:

```ts
      let acc = "";
      const toolCalls: MessageToolCall[] = [];
      const subagents: MessageSubagent[] = [];
      const foundImages: MessageImage[] = [];
      let reasoning = "";
      const apiTrace: ApiTraceEntry[] = [];
      let lastFlush = 0;
      const flushStreamingState = () => {
        set({
          streamingContent: acc,
          streamingToolCalls: [...toolCalls],
          streamingSubagents: [...subagents],
          streamingImages: [...foundImages],
          streamingReasoning: reasoning,
          streamingApiTrace: [...apiTrace],
          streamingProvider: replyProvider,
          streamingModel: replyModel,
          ...(acc.length > 0 ? { awaitingModel: false } : {}),
        });
      };
      set({
        streamingContent: "",
        streamingToolCalls: [],
        streamingSubagents: [],
        streamingImages: [],
        streamingReasoning: "",
        streamingApiTrace: [],
        streamingBotId: attributeBotId,
        streamingProvider: replyProvider,
        streamingModel: replyModel,
      });
      const onDelta = (event: StreamEvent) => {
        if (event.approvalRequest) {
          const req = event.approvalRequest;
          if (get().autoApproveSysTools) {
            void approveToolCall(req.id, true);
          } else {
            set({ pendingApproval: req });
          }
          return;
        }
        applyToolEvent(event, toolCalls);
        applySubagentEvent(event, subagents);
        applyTraceEvent(event, apiTrace);
        if (event.reasoning) reasoning += event.reasoning.text;
        if (event.toolImages) {
          for (const img of event.toolImages.images) {
            foundImages.push({
              media_type: img.mediaType,
              data: img.data,
              source: img.sourceUrl,
              title: img.title,
            });
          }
        }
        if (event.text) acc += event.text;
        if (event.toolDone || event.subagent) set({ awaitingModel: true });
        const now = performance.now();
        if (now - lastFlush > 100) {
          lastFlush = now;
          flushStreamingState();
        }
      };
```

Add `flushStreamingState();` after the `chatStream` call (line 2532).

Replace the persistence block (lines 2533–2601) with batched writes + streaming clear + reload (same pattern as Task 2 Steps 4-5).

- [ ] **Step 3: Add streaming-state clear to `regenerate` and `requestSources` finally blocks**

In `regenerate`'s `finally` block (lines 2325–2341) and `requestSources`'s `finally` block (lines 2607–2624), add streaming state clear to the returned `set()` object after `awaitingModel: false,`:

```ts
            streamingContent: null,
            streamingToolCalls: [],
            streamingSubagents: [],
            streamingImages: [],
            streamingReasoning: "",
            streamingApiTrace: [],
            streamingBotId: null,
            streamingProvider: null,
            streamingModel: null,
```

- [ ] **Step 4: Commit**

```bash
git add src/store/threads.ts
git commit -m "Refactor regenerate and requestSources to use throttled streaming state"
```

---

### Task 5: Update MessageList to render from `streamingContent`

**Files:**
- Modify: `src/components/chat/MessageList.tsx`

**Interfaces:**
- Consumes: `streamingContent` and related fields from store
- Produces: Streaming bubble rendered from `streamingContent`, not from `STREAM_ID` in `messages[]`

- [ ] **Step 1: Select streaming state in MessageList**

At the top of the `MessageList` function component, add selectors for streaming state:

```ts
  const streamingContent = useThreads((s) => s.streamingContent);
  const streamingToolCalls = useThreads((s) => s.streamingToolCalls);
  const streamingSubagents = useThreads((s) => s.streamingSubagents);
  const streamingImages = useThreads((s) => s.streamingImages);
  const streamingBotId = useThreads((s) => s.streamingBotId);
  const streamingProvider = useThreads((s) => s.streamingProvider);
  const streamingModel = useThreads((s) => s.streamingModel);
```

- [ ] **Step 2: Compute `displayItems` that includes the streaming placeholder**

After the `useMemo` blocks that compute `botsById`, etc., add:

```ts
  const displayItems = useMemo(() => {
    if (streamingContent === null) return messages;
    return [
      ...messages,
      {
        id: STREAM_ID,
        thread_id: messages[0]?.thread_id ?? "",
        role: "assistant" as const,
        content: streamingContent,
        kind: "normal" as const,
        duration_ms: null,
        bot_id: streamingBotId,
        variant_group: null,
        variant_selected: 1,
        created_at: "",
        provider: streamingProvider,
        model: streamingModel,
        images: streamingImages,
        documents: [],
        toolCalls: streamingToolCalls,
        subagents: streamingSubagents,
      } as MessageView,
    ];
  }, [
    messages,
    streamingContent,
    streamingToolCalls,
    streamingSubagents,
    streamingImages,
    streamingBotId,
    streamingProvider,
    streamingModel,
  ]);
```

- [ ] **Step 3: Update Virtuoso `data` prop**

Change line 1284 from `data={messages}` to `data={displayItems}`.

- [ ] **Step 4: Update `pending` / empty-chat check**

Line 1274 checks `messages.length === 0 && !pending`. With `displayItems`, we should check `displayItems.length === 0 && !pending`:

Change line 1274 from:
```tsx
  if (messages.length === 0 && !pending) {
```
to:
```tsx
  if (displayItems.length === 0 && !pending) {
```

- [ ] **Step 5: Update `lastAssistantIndex` loop**

Lines 1238–1242 iterate over `messages` to find the last assistant index. Change to iterate over `displayItems`:

```ts
  let lastAssistantIndex = -1;
  for (let k = 0; k < displayItems.length; k++) {
    if (displayItems[k].role === "assistant" && displayItems[k].kind === "normal")
      lastAssistantIndex = k;
  }
```

- [ ] **Step 6: Update `imageOffsets` / `videoOffsets`**

Line 1252 passes `messages` to `mediaLabelOffsets`. Change to `displayItems`:

```ts
  const { imageOffsets, videoOffsets } = mediaLabelOffsets(displayItems, ytEnabled);
```

- [ ] **Step 7: Commit**

```bash
git add src/components/chat/MessageList.tsx
git commit -m "Render streaming bubble from streamingContent in MessageList"
```

---

### Task 6: Update ChatView "Thinking…" pending check

**Files:**
- Modify: `src/components/chat/ChatView.tsx`

- [ ] **Step 1: Add `streamingContent` selector**

In `ChatView`, add:

```ts
const streamingContent = useThreads((s) => s.streamingContent);
```

- [ ] **Step 2: Update the `pending` computation**

Replace lines 167–173:

```ts
  const last = messages[messages.length - 1];
  const awaitingModel = useThreads((s) => s.awaitingModel);
  const pending = busy && (!last || last.role === "user" || awaitingModel);
```

With:

```ts
  const last = messages[messages.length - 1];
  const awaitingModel = useThreads((s) => s.awaitingModel);
  const streamingContent = useThreads((s) => s.streamingContent);
  const pending =
    busy &&
    (!last || last.role === "user" || awaitingModel) &&
    (!streamingContent || awaitingModel);
```

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/ChatView.tsx
git commit -m "Update pending check for streamingContent in ChatView"
```

---

### Task 7: Clear streaming state on thread switch

**Files:**
- Modify: `src/store/threads.ts`: `selectThread`

- [ ] **Step 1: Add streaming-state clear in `selectThread`**

In `selectThread` (line 700), after the `savedMessages` save (lines 705–708) and before restoring:

At line 709 (right after the `savedMessages` block), add:

```ts
    // Clear any streaming state from the previous thread — the bubble
    // lives in store fields now, not inside messages[].
    set({
      streamingContent: null,
      streamingToolCalls: [],
      streamingSubagents: [],
      streamingImages: [],
      streamingReasoning: "",
      streamingApiTrace: [],
      streamingBotId: null,
      streamingProvider: null,
      streamingModel: null,
    });
```

- [ ] **Step 2: Commit**

```bash
git add src/store/threads.ts
git commit -m "Clear streaming state on thread switch"
```

---

### Task 8: Rust — Make `ollama_unload` async

**Files:**
- Modify: `src-tauri/src/commands/ollama.rs`

- [ ] **Step 1: Change command to async and use tokio::process**

Replace lines 104–127:

```rust
#[tauri::command]
pub async fn ollama_unload(model: String) -> Result<(), String> {
    let name = model.trim();
    if name.is_empty() || name.split_whitespace().count() != 1 {
        return Err("invalid model name".into());
    }
    let out = match tokio::process::Command::new("ollama")
        .arg("stop")
        .arg(name)
        .output()
        .await
    {
        Ok(out) => out,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(not_installed_error()),
        Err(e) => return Err(format!("couldn't unload model: {e}")),
    };
    if out.status.success() {
        Ok(())
    } else {
        Err(format!(
            "ollama stop failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}
```

- [ ] **Step 2: Verify with `cargo clippy`**

Run: `cargo clippy` (from `src-tauri/`)
Expected: PASS — no warnings.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/ollama.rs
git commit -m "Make ollama_unload async using tokio::process"
```

---

### Task 9: Rust — Make `take_screenshot` async

**Files:**
- Modify: `src-tauri/src/commands/quick.rs`

- [ ] **Step 1: Replace `std::thread::sleep` with `tokio::time::sleep`**

Change line 143 from:
```rust
        std::thread::sleep(std::time::Duration::from_millis(150));
```
to:
```rust
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
```

- [ ] **Step 2: Mark command as async and wrap process calls**

Change line 129:
```rust
#[tauri::command]
pub fn take_screenshot(
```
to:
```rust
#[tauri::command]
pub async fn take_screenshot(
```

And change the `capture_interactive()` call (line 146) to be compatible. Since `capture_interactive` is a sync fn using `std::process::Command`, wrap it in `tokio::task::spawn_blocking`:

```rust
    let result = tokio::task::spawn_blocking(capture_interactive)
        .await
        .map_err(|e| e.to_string())?;
```

Wait — `capture_interactive` returns `Result<Option<String>, String>`. `spawn_blocking` returns `Result<T, JoinError>`. So:

```rust
    let result = tokio::task::spawn_blocking(capture_interactive)
        .await
        .map_err(|e| e.to_string())??;
```

Actually, let me look at the existing function signature more carefully. `capture_interactive` (line 242) returns `Result<Option<String>, String>`. Let me trace through:

Current line 146:
```rust
    let result = capture_interactive();
```

New:
```rust
    let result = tokio::task::spawn_blocking(capture_interactive)
        .await
        .map_err(|e| format!("screenshot task panicked: {e}"))?;
```

Since `capture_interactive` returns `Result<Option<String>, String>`, we need to flatten. Actually the `?` in `.map_err(...)?;` unwraps the outer `Result` (from `spawn_blocking`), giving us `Result<Option<String>, String>`. But `capture_interactive()` already returns that type... Wait, `spawn_blocking` wraps the return type in a Result. So:

`spawn_blocking(capture_interactive)` returns `JoinHandle<Result<Option<String>, String>>`.
`.await` gives `Result<Result<Option<String>, String>, JoinError>`.

We need to flatten this. The cleanest way:

```rust
    let result = tokio::task::spawn_blocking(capture_interactive)
        .await
        .map_err(|e| format!("screenshot failed: {e}"))?;
```

This gives us `Result<Option<String>, String>` in `result`. Then the `?` on the original function would propagate the `Err(String)`. Actually, the function already returns `Result<Option<String>, String>`, so we can just use `result?` or return `result`:

```rust
    let result = tokio::task::spawn_blocking(capture_interactive)
        .await
        .map_err(|e| format!("screenshot failed: {e}"))?;
```

Wait, this doesn't compile. `spawn_blocking` returns `JoinHandle` which on `.await` gives `Result<R, JoinError>` where `R` is the return of the closure. So `.await` gives `Result<Result<Option<String>, String>, JoinError>`. Using `?` once gives `Result<Option<String>, String>`. Then we need to use it.

```rust
    let inner = tokio::task::spawn_blocking(capture_interactive)
        .await
        .map_err(|e| format!("screenshot failed: {e}"))?;
    let result = inner?;
```

Or use `Ok(inner?)`. Since the function returns `Result<Option<String>, String>` and we're at the end:

Actually the simplest approach: since `capture_interactive` already does I/O, just make it work. But to keep it simple and avoid the double-Result issue, let me just use:

```rust
    let result = tokio::task::spawn_blocking(capture_interactive)
        .await
        .map_err(|e| format!("screenshot failed: {e}"))?
        .map_err(|e| format!("screenshot failed: {e}"))?;
```

No wait. Let me think again.

`tokio::task::spawn_blocking(|| capture_interactive())` - the closure returns `Result<Option<String>, String>`.
`spawn_blocking` returns `JoinHandle<Result<Option<String>, String>>`.
`.await` returns `Result<Result<Option<String>, String>, JoinError>`.

Option 1: Flatten with two `?`:
```rust
let result = spawn_blocking(capture_interactive).await.map_err(...)??;
```
The outer `?` unwraps `JoinError`, the inner `?` unwraps `String`. This yields `Option<String>`.

Option 2: Return directly:
```rust
spawn_blocking(capture_interactive).await.map_err(...)?
```
This returns `Result<Option<String>, String>` from the function. Since the function's return type is `Result<Option<String>, String>`, this works.

Let me just use option 1 for clarity:

```rust
    let result = tokio::task::spawn_blocking(capture_interactive)
        .await
        .map_err(|e| format!("screenshot task failed: {e}"))??;
```

The `??` double-unwraps: first `JoinError`, then `String`.

Then `result` is `Option<String>`, and we can wrap it in `Ok(result)`.

OK let me simplify. Since the entire function already does the `capture_interactive` call, we can just wrap the whole body after the sleep + capture in one go. Let me present cleaner code.

- [ ] **Step 3: Verify with `cargo clippy`**

Run: `cargo clippy` (from `src-tauri/`)
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/quick.rs
git commit -m "Make take_screenshot async with tokio::time::sleep"
```

---

### Task 10: Rust — Make keychain commands async

**Files:**
- Modify: `src-tauri/src/commands/keys.rs`

- [ ] **Step 1: Make `set_api_key` async with `spawn_blocking`**

Change line 71–84:

```rust
#[tauri::command]
pub async fn set_api_key(
    provider: String,
    key: String,
    cache: State<'_, KeyCache>,
) -> Result<(), String> {
    let provider_clone = provider.clone();
    let key_clone = key.clone();
    tokio::task::spawn_blocking(move || {
        entry(&provider_clone)?
            .set_password(&key_clone)
            .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| format!("keychain write failed: {e}"))??;
    cache.store(&provider, &key);
    Ok(())
}
```

Wait, `cache` is `State<'_, KeyCache>` which can't be moved into `spawn_blocking`. And `entry` is also sync. We need to only wrap the `Entry` call:

```rust
#[tauri::command]
pub async fn set_api_key(
    provider: String,
    key: String,
    cache: State<'_, KeyCache>,
) -> Result<(), String> {
    let p = provider.clone();
    let k = key.clone();
    tokio::task::spawn_blocking(move || {
        entry(&p)?.set_password(&k).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("keychain write failed: {e}"))??;
    cache.store(&provider, &key);
    Ok(())
}
```

- [ ] **Step 2: Make `has_api_key` async**

Change line 87–94:

```rust
#[tauri::command]
pub async fn has_api_key(provider: String) -> Result<bool, String> {
    let p = provider.clone();
    tokio::task::spawn_blocking(move || {
        match entry(&p)?.get_password() {
            Ok(_) => Ok(true),
            Err(KeyringError::NoEntry) => Ok(false),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| format!("keychain read failed: {e}"))?
}
```

- [ ] **Step 3: Make `delete_api_key` async**

Change line 120–129:

```rust
#[tauri::command]
pub async fn delete_api_key(provider: String, cache: State<'_, KeyCache>) -> Result<(), String> {
    let p = provider.clone();
    let result = tokio::task::spawn_blocking(move || {
        match entry(&p)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| format!("keychain delete failed: {e}"))??;
    cache.invalidate(&provider);
    Ok(result)
}
```

Wait, `delete_credential` returns `Result<(), KeyringError>`. The `spawn_blocking` closure returns `Result<(), String>`. The `.await` gives `Result<Result<(), String>, JoinError>`. The outer `?` after `.map_err(...)` gives `Result<(), String>`. Then we need to unwrap the inner: `??` gives `()`.

Actually let me double check. `spawn_blocking(move || { ... })` returns `JoinHandle<Result<(), String>>`. `.await` returns `Result<Result<(), String>, JoinError>`. `.map_err(|e| ...)?` unwraps `JoinError` → gives `Result<(), String>`. `??` gives `()`.

Actually no. `.map_err(...)?` gives us `Result<(), String>` (the inner result). Then `.map_err(...)??` - the first `?` unwraps the outer JoinError to give us `Result<(), String>`, then `??` tries to apply `?` to a `Result<(), String>` which gives `()`. But we want `Ok(())` at the end.

Let me just be clear. `delete_api_key` returns `Result<(), String>`. The body:

```rust
#[tauri::command]
pub async fn delete_api_key(provider: String, cache: State<'_, KeyCache>) -> Result<(), String> {
    let p = provider.clone();
    tokio::task::spawn_blocking(move || {
        match entry(&p)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| format!("keychain delete failed: {e}"))?; // This gives Result<(), String>
    cache.invalidate(&provider);
    Ok(())
}
```

Wait, `.await` returns `Result<Result<(), String>, JoinError>`. Then `.map_err(...)?`:
- `.map_err(...)` transforms `JoinError` to `String` → `Result<Result<(), String>, String>`
- `?` unwraps: if `Err(String)`, returns early. If `Ok(Result<(), String>)`, gives `Result<(), String>`.

So the expression after `?` has type `Result<(), String>`. But we're inside an async fn that returns `Result<(), String>`. We can't have a bare `Result<(), String>` as a statement without handling it. Let me add `?`:

```rust
    tokio::task::spawn_blocking(move || {
        ...
    })
    .await
    .map_err(|e| format!("keychain delete failed: {e}"))??;  // double ? to unwrap both layers
    cache.invalidate(&provider);
    Ok(())
```

The `??` first unwraps `JoinError`, then unwraps the inner `String`. Result: `()`. Then `cache.invalidate` and `Ok(())`. This works.

- [ ] **Step 4: Verify with `cargo clippy`**

Run: `cargo clippy` (from `src-tauri/`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/keys.rs
git commit -m "Make keychain commands async with tokio::spawn_blocking"
```

---

### Task 11: Clean up `STREAM_ID` references and final verify

**Files:**
- Modify: `src/store/threads.ts`: remove unused `STREAM_ID` constant (or keep for MessageList)
- No changes needed to `streamingContext.ts` (still works via `streaming` prop)

- [ ] **Step 1: Remove unused STREAM_ID code paths in store**

The `STREAM_ID` constant is still used by MessageList (for the synthetic item's `id`) and by any remaining references in the store. Search for remaining `STREAM_ID` references in `threads.ts`:

Run: `rg "STREAM_ID" src/store/threads.ts`

Any remaining code paths that create/modify a `STREAM_ID` placeholder in `messages[]` should be gone after Tasks 2–4. If any remain (e.g., in the `finally` block or `cancel`), clean them up.

- [ ] **Step 2: Run full typecheck**

```bash
npm run build
```
Expected: PASS — no type errors.

- [ ] **Step 3: Run Rust lints**

```bash
cd src-tauri && cargo clippy
```
Expected: PASS — no warnings.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Clean up STREAM_ID references after streaming state migration"
```

---

### Verification Checklist

After all tasks complete, verify manually:

1. Send a normal chat message — text streams smoothly, no UI freeze
2. Send a long planner task — UI remains responsive during planning, critiquing, step execution
3. Cancel mid-stream — partial text is persisted and shown
4. Switch threads during streaming — background stream completes, unread indicator appears
5. Regenerate a reply — streaming works with throttled updates
6. Request sources — streaming works with throttled updates
7. Screenshot capture — no 150ms hang
8. Ollama model unload — no blocking delay
9. Settings → API keys — save/check/delete work without blocking
