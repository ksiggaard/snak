> 📐 **Historical design doc.** A dated, point-in-time design record — kept for the
> rationale, not as current truth. For how the feature works today,
> [`AGENTS.md`](../../../AGENTS.md) is canonical; where this doc and the code disagree,
> the code wins.

# Chat max-width + per-reply full-width toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap the chat column to a configurable, centered max-width (default 760px, on by default, adjustable/dismissable in Appearance settings), with a session-only per-reply toggle to expand any single assistant reply to full width.

**Architecture:** The cap is applied **per message row** (and to the composer), not as one wrapper around the transcript — so a single reply can break out to full width while neighbours stay capped. Each row gets `mx-auto w-full` + an inline `max-width`; flexbox auto-margins center it only when the chat area is wider than the cap. A new `chatMaxWidth: number | null` appearance pref (number = capped px, `null` = off) drives the cap; full-width toggle state is ephemeral React state in `MessageList`.

**Tech Stack:** React 19 + TypeScript, Zustand (`useAppearance`), Tailwind v4, shadcn/ui, vitest (jsdom). i18n via the homegrown catalog in `src/lib/i18n.ts`.

**Spec:** `docs/superpowers/specs/2026-06-16-chat-max-width-design.md`

**Branch:** Work continues on `feat/chat-max-width` (already checked out; spec + an unrelated map fix are already committed there).

---

## File Structure

- `src/lib/appearance.ts` — **modify.** Add `CHAT_WIDTH` bounds + `getStoredChatMaxWidth`/`storeChatMaxWidth` (pure persistence, like `getStoredRadius`).
- `src/lib/appearance.test.ts` — **modify.** Unit tests for the new storage fns.
- `src/store/appearance.ts` — **modify.** Add `chatMaxWidth` state + `setChatMaxWidth` action.
- `src/lib/i18n.ts` — **modify.** Add `chat.fullWidth`, `chat.exitFullWidth`, and `chatWidth.*` keys to the `en` catalog.
- `src/components/chat/MessageList.tsx` — **modify.** Per-row centering, session full-width state, and the toggle button in `AssistantMeta`.
- `src/components/chat/ChatView.tsx` — **modify.** Center the composer/error/approval stack at the cap.
- `src/components/settings/Appearance.tsx` — **modify.** New `ChatWidthCard` (on/off toggle + width slider).

---

## Task 1: Appearance pref — storage fns (`src/lib/appearance.ts`)

**Files:**
- Modify: `src/lib/appearance.ts`
- Test: `src/lib/appearance.test.ts`

- [ ] **Step 1: Write the failing tests**

Append this block to the **end** of `src/lib/appearance.test.ts`:

```ts
describe("chat max-width preference (CHAT_WIDTH)", () => {
  it("defaults to the fallback width when nothing is stored", () => {
    expect(getStoredChatMaxWidth()).toBe(CHAT_WIDTH.fallback);
  });

  it("stores the 'off' sentinel for null and reads it back as null (cap off)", () => {
    storeChatMaxWidth(null);
    expect(localStorage.getItem("chat-max-width")).toBe("off");
    expect(getStoredChatMaxWidth()).toBeNull();
  });

  it("round-trips a custom in-range width", () => {
    storeChatMaxWidth(900);
    expect(getStoredChatMaxWidth()).toBe(900);
  });

  it("clamps an out-of-range stored width to the bounds", () => {
    localStorage.setItem("chat-max-width", "5000");
    expect(getStoredChatMaxWidth()).toBe(CHAT_WIDTH.max);
    localStorage.setItem("chat-max-width", "100");
    expect(getStoredChatMaxWidth()).toBe(CHAT_WIDTH.min);
  });

  it("falls back to the default for unparseable values", () => {
    localStorage.setItem("chat-max-width", "garbage");
    expect(getStoredChatMaxWidth()).toBe(CHAT_WIDTH.fallback);
  });

  it("removes the key when set to the default width (absence = default-on)", () => {
    storeChatMaxWidth(900);
    storeChatMaxWidth(CHAT_WIDTH.fallback);
    expect(localStorage.getItem("chat-max-width")).toBeNull();
    expect(getStoredChatMaxWidth()).toBe(CHAT_WIDTH.fallback);
  });
});
```

Then add the three new names to the existing import block at the top of `src/lib/appearance.test.ts` (the `import { ... } from "@/lib/appearance"` list): `CHAT_WIDTH`, `getStoredChatMaxWidth`, `storeChatMaxWidth`. (`beforeEach` already calls `localStorage.clear()` at line 42 — no new setup needed.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/appearance.test.ts -t "chat max-width"`
Expected: FAIL — `getStoredChatMaxWidth`/`storeChatMaxWidth`/`CHAT_WIDTH` are not exported (TS/import error or "is not a function").

- [ ] **Step 3: Implement the storage fns**

In `src/lib/appearance.ts`, add the bounds constant next to the other `SizeRange` exports (after the `RADIUS` declaration, ~line 63):

```ts
/** Chat column max-width bounds (px). Caps message + composer width on wide
 * windows and centers the conversation; default 760 (cap on). `null` = off
 * (full width). Consumed via React props, not injected CSS — see store. */
export const CHAT_WIDTH: SizeRange = { min: 560, max: 1280, fallback: 760 };
```

Add the localStorage key alongside the other key constants (near `RADIUS_KEY`, ~line 67):

```ts
const CHAT_WIDTH_KEY = "chat-max-width";
```

Add the get/set fns near `getStoredRadius`/`storeRadius` (~line 342–352):

```ts
/**
 * The chat column max-width in px, or `null` when the cap is off (full width).
 * Default (nothing stored) is `CHAT_WIDTH.fallback` (cap on). The literal
 * `"off"` is the explicit opt-out; any stored number is clamped to CHAT_WIDTH.
 */
export function getStoredChatMaxWidth(): number | null {
  const raw = localStorage.getItem(CHAT_WIDTH_KEY);
  if (raw === null) return CHAT_WIDTH.fallback;
  if (raw === "off") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? clampSize(n, CHAT_WIDTH) : CHAT_WIDTH.fallback;
}

/**
 * Persist the chat max-width: `null` writes the `"off"` opt-out; the default
 * width removes the key (absence = default-on); any other value is clamped and
 * stored as a number string.
 */
export function storeChatMaxWidth(v: number | null): void {
  if (v === null) {
    localStorage.setItem(CHAT_WIDTH_KEY, "off");
    return;
  }
  const clamped = clampSize(v, CHAT_WIDTH);
  if (clamped === CHAT_WIDTH.fallback) localStorage.removeItem(CHAT_WIDTH_KEY);
  else localStorage.setItem(CHAT_WIDTH_KEY, String(clamped));
}
```

(`clampSize` and the `SizeRange` type are already defined in this file.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/appearance.test.ts -t "chat max-width"`
Expected: PASS (6 passing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/appearance.ts src/lib/appearance.test.ts
git commit -m "feat(appearance): add chat max-width preference storage"
```

---

## Task 2: Appearance store wiring (`src/store/appearance.ts`)

**Files:**
- Modify: `src/store/appearance.ts`

- [ ] **Step 1: Import the new lib symbols**

In `src/store/appearance.ts`, add `getStoredChatMaxWidth` and `storeChatMaxWidth` to the existing `import { ... } from "@/lib/appearance"` block (keep it alphabetized-ish with the other `getStored*`/`store*` names).

- [ ] **Step 2: Add state + action to the interface**

In the `AppearanceState` interface, after the `animations: boolean;` field (~line 43) add:

```ts
  /** Chat column max-width in px; `null` = off (full width). Default 760. */
  chatMaxWidth: number | null;
```

And after the `setAnimations` action declaration (~line 62) add:

```ts
  /** Set the chat column max-width (number = capped px, `null` = off). */
  setChatMaxWidth: (v: number | null) => void;
```

- [ ] **Step 3: Seed state + implement the action**

In the `create<AppearanceState>(...)` body, add the seed after `animations: getStoredAnimations(),` (~line 71):

```ts
  chatMaxWidth: getStoredChatMaxWidth(),
```

And add the action after the `setAnimations` implementation (~line 140), before the closing `}));`:

```ts
  setChatMaxWidth: (v) => {
    storeChatMaxWidth(v);
    set({ chatMaxWidth: v });
  },
```

(No `apply*` call — this is a render-mode pref consumed by React, like `chatStyle`; nothing to inject into the DOM.)

- [ ] **Step 4: Verify it compiles**

Run: `npm run build`
Expected: PASS (tsc + vite build succeed). If tsc errors about the new field, re-check the interface/seed names match exactly.

- [ ] **Step 5: Commit**

```bash
git add src/store/appearance.ts
git commit -m "feat(appearance): expose chatMaxWidth in the appearance store"
```

---

## Task 3: i18n keys (`src/lib/i18n.ts`)

**Files:**
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: Add the chat toggle keys**

In the `en` catalog, in the "Chat view / message list" section, directly after the `"chat.copied": "Copied",` line (~line 186) add:

```ts
  "chat.fullWidth": "Full width",
  "chat.exitFullWidth": "Fit to column",
```

- [ ] **Step 2: Add the settings-card keys**

After the chat-list card section (after `"chatList.mockPreview": "...",`, ~line 612) and before the `// --- Settings: language card` comment, add:

```ts
  // --- Settings: appearance — chat width card ------------------------------
  "chatWidth.title": "Chat width",
  "chatWidth.description":
    "Cap how wide messages and the composer get on large windows, centering the conversation. Individual replies can still be expanded to full width.",
  "chatWidth.label": "Limit width",
  "chatWidth.widthLabel": "Max width",
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: PASS. (`MessageKey` is derived from this catalog, so these keys are now valid for `t(...)`. Other locale packs fall back to English automatically — no other files need editing.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n.ts
git commit -m "i18n: add chat width + full-width toggle strings"
```

---

## Task 4: Per-row centering + full-width toggle (`src/components/chat/MessageList.tsx`)

**Files:**
- Modify: `src/components/chat/MessageList.tsx`

- [ ] **Step 1: Add imports**

In the lucide-react import block (lines 3–18), add `FoldHorizontal` and `UnfoldHorizontal` (alphabetical: `FoldHorizontal` after `FileText`/`FoldVertical` area, `UnfoldHorizontal` near `TriangleAlert`/`Wrench`). In the React import on line 1, add `useCallback`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
```

(`useAppearance` is already imported on line 40.)

- [ ] **Step 2: Extend `AssistantMeta` with the toggle**

In the `AssistantMeta` component, add two optional props to its signature (after `trailing?: React.ReactNode;`):

```ts
  /** When provided, renders the full-width toggle (cap is on + assistant reply). */
  onToggleWide?: () => void;
  /** Whether this reply is currently expanded to full width. */
  wide?: boolean;
```

Destructure them in the params list: `}: { ... trailing?: React.ReactNode; onToggleWide?: () => void; wide?: boolean; })`.

Then, inside the returned `<div>`, between the copy `<button>` and `{trailing}` (right after the copy button's closing `</button>`, ~line 444), add:

```tsx
      {onToggleWide && (
        <button
          type="button"
          onClick={onToggleWide}
          aria-label={wide ? t("chat.exitFullWidth") : t("chat.fullWidth")}
          title={wide ? t("chat.exitFullWidth") : t("chat.fullWidth")}
          className="hover:bg-muted hover:text-foreground rounded p-1 transition-colors"
        >
          {wide ? (
            <FoldHorizontal className="size-3.5" aria-hidden />
          ) : (
            <UnfoldHorizontal className="size-3.5" aria-hidden />
          )}
        </button>
      )}
```

- [ ] **Step 3: Thread props through `ChatMessage`**

In the `ChatMessage` props type (the big inline `{ ... }` after `function ChatMessage({`), add to the destructured params: `maxWidth`, `wide`, `onToggleWide`. Add to the type annotation:

```ts
  /** Effective max-width (px) for this row, or undefined for full width
   *  (cap off, or this reply toggled wide). Applied as inline style. */
  maxWidth?: number;
  /** Whether this reply is expanded to full width (session-only). */
  wide?: boolean;
  /** Toggle this reply's full-width state; only passed when the cap is on. */
  onToggleWide?: () => void;
```

Update the `meta` const (~line 817) to pass them to `AssistantMeta`:

```tsx
  const meta = m.role === "assistant" && (
    <AssistantMeta
      createdAt={m.created_at}
      durationMs={m.duration_ms}
      now={now}
      content={m.content}
      wide={wide}
      onToggleWide={onToggleWide}
      trailing={variations}
    />
  );
```

- [ ] **Step 4: Apply centering to every row branch**

`ChatMessage` has four return branches whose outer element is `<div ref={innerRef} data-mid={m.id} className="flex scroll-mt-4 ...">`. For **each** of the four (compact ~line 845, cozy ~line 897, terminal ~line 948, and the default `styleClasses` branch ~line 991), add `mx-auto w-full` to that outer div's className and add `style={{ maxWidth }}`.

Compact (line ~844-845):

```tsx
      <div
        ref={innerRef}
        data-mid={m.id}
        className="mx-auto flex w-full scroll-mt-4"
        style={{ maxWidth }}
      >
```

Cozy (line ~897):

```tsx
      <div
        ref={innerRef}
        data-mid={m.id}
        className="mx-auto flex w-full scroll-mt-4 gap-2.5"
        style={{ maxWidth }}
      >
```

Terminal (line ~948):

```tsx
      <div
        ref={innerRef}
        data-mid={m.id}
        className="mx-auto flex w-full scroll-mt-4"
        style={{ maxWidth }}
      >
```

Default branch (line ~991):

```tsx
    <div
      ref={innerRef}
      data-mid={m.id}
      className={cn("mx-auto flex w-full scroll-mt-4", row)}
      style={{ maxWidth }}
    >
```

- [ ] **Step 5: Add cap state + wiring in `MessageList`**

In the `MessageList` function body (after the existing `const chatStyle = useAppearance(...)` line ~1025), add:

```ts
  const chatMaxWidth = useAppearance((s) => s.chatMaxWidth);
  // Session-only set of reply ids expanded to full width (T-chat-width). Not
  // persisted — resets on restart, mirroring other per-session chat UI state.
  const [wideIds, setWideIds] = useState<Set<string>>(() => new Set());
  const toggleWide = useCallback((id: string) => {
    setWideIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  // The cap only makes sense (and the per-reply toggle is only offered) when a
  // max-width is set; null = full width everywhere.
  const capped = chatMaxWidth != null;
```

- [ ] **Step 6: Center the summary divider + pending indicator, and pass props to `ChatMessage`**

In the summary branch of the `.map` (the `<div key={m.id} ...>` with `className={cn("scroll-mt-4", ...)}`, ~line 1106-1117), change it to center at the cap:

```tsx
          <div
            key={m.id}
            ref={(el) => {
              if (el) messageRefs.current.set(m.id, el);
              else messageRefs.current.delete(m.id);
            }}
            className={cn(
              "mx-auto w-full scroll-mt-4",
              flashId === m.id &&
                "ring-primary rounded-lg ring-2 ring-offset-2",
            )}
            style={{ maxWidth: chatMaxWidth ?? undefined }}
          >
```

In the `ChatMessage` render call (~line 1133), add the three new props:

```tsx
          <ChatMessage
            key={m.id}
            m={m}
            chatStyle={chatStyle}
            flashed={flashId === m.id}
            now={now}
            bot={bot}
            latestReply={idx === lastAssistantIndex}
            imageLabelStart={imageOffsets[idx]}
            videoLabelStart={videoOffsets[idx]}
            maxWidth={
              capped && !wideIds.has(m.id) ? chatMaxWidth : undefined
            }
            wide={wideIds.has(m.id)}
            onToggleWide={capped ? () => toggleWide(m.id) : undefined}
            mentionBot={
              m.bot_id ? (bots.find((b) => b.id === m.bot_id) ?? null) : null
            }
            innerRef={(el) => {
              if (el) messageRefs.current.set(m.id, el);
              else messageRefs.current.delete(m.id);
            }}
          />
```

Wrap the pending "Thinking…" block (~line 1153) so it centers at the cap. Change `<div className="flex justify-start">` to:

```tsx
      {pending && (
        <div
          className="mx-auto flex w-full justify-start"
          style={{ maxWidth: chatMaxWidth ?? undefined }}
        >
```

(Leave the inner thinking-dots markup unchanged.)

- [ ] **Step 7: Verify it compiles + lint**

Run: `npm run build && npm run lint`
Expected: PASS. Watch for: unused `wide`/`onToggleWide`, or a missing prop on `AssistantMeta`/`ChatMessage`.

- [ ] **Step 8: Commit**

```bash
git add src/components/chat/MessageList.tsx
git commit -m "feat(chat): cap + center message rows; per-reply full-width toggle"
```

---

## Task 5: Composer alignment (`src/components/chat/ChatView.tsx`)

**Files:**
- Modify: `src/components/chat/ChatView.tsx`

- [ ] **Step 1: Import the store + read the pref**

Add the import near the other store imports (after the `useBots` import, line 8):

```ts
import { useAppearance } from "@/store/appearance";
```

In the `ChatView` function body, after `const draftBotId = useThreads((s) => s.draftBotId);` (~line 113), add:

```ts
  const chatMaxWidth = useAppearance((s) => s.chatMaxWidth);
```

- [ ] **Step 2: Wrap the composer/error/approval stack in a centered column**

In the returned JSX, replace the three bottom siblings (the `{error && ...}` paragraph, `<ApprovalGate .../>`, and `<Composer .../>`, ~lines 186–198) with a single centered wrapper around them — leaving `<MessageList .../>` / `<IncognitoExplainer/>` above it untouched (those self-center per Task 4):

```tsx
        <div
          className="mx-auto flex w-full flex-col gap-3"
          style={{ maxWidth: chatMaxWidth ?? undefined }}
        >
          {error && <p className="text-destructive px-1 text-sm">{error}</p>}
          <ApprovalGate providerLabel={providerLabel} local={providerLocal} />
          <Composer
            onSend={(text, images, documents) =>
              void send(text, images, documents)
            }
            onCancel={() => void cancel()}
            busy={busy}
            provider={provider}
            model={model}
            providerEnabled={providerEnabled}
            anyProvider={anyProvider}
          />
        </div>
```

- [ ] **Step 3: Verify it compiles + lint**

Run: `npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/ChatView.tsx
git commit -m "feat(chat): align composer to the capped message column"
```

---

## Task 6: Appearance settings card (`src/components/settings/Appearance.tsx`)

**Files:**
- Modify: `src/components/settings/Appearance.tsx`

- [ ] **Step 1: Import `CHAT_WIDTH`**

Add `CHAT_WIDTH` to the existing `import { ... } from "@/lib/appearance"` block (~lines 19–33), next to `CHAT_SIZE`.

- [ ] **Step 2: Add `<ChatWidthCard />` to the section**

In the `Appearance()` component's returned list, add it after `<ChatStyleCard />` (line ~56):

```tsx
      <ChatStyleCard />
      <ChatWidthCard />
      <ChatListCard />
```

- [ ] **Step 3: Implement `ChatWidthCard`**

Add this component near `ChatStyleCard` (anywhere at module scope, e.g. right after the `ChatStyleCard` function ~line 211):

```tsx
/** Chat column max-width (T-chat-width): an on/off cap plus a width slider.
 *  Off = full width; on = centered column at the chosen px on wide windows. */
function ChatWidthCard() {
  const t = useT();
  const chatMaxWidth = useAppearance((s) => s.chatMaxWidth);
  const setChatMaxWidth = useAppearance((s) => s.setChatMaxWidth);
  const on = chatMaxWidth !== null;
  const width = chatMaxWidth ?? CHAT_WIDTH.fallback;

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t("chatWidth.title")}</CardTitle>
        <CardDescription>{t("chatWidth.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <OptionRow label={t("chatWidth.label")}>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={on ? "on" : "off"}
            onValueChange={(v) =>
              v && setChatMaxWidth(v === "on" ? width : null)
            }
          >
            <ToggleGroupItem value="on">{t("common.on")}</ToggleGroupItem>
            <ToggleGroupItem value="off">{t("common.off")}</ToggleGroupItem>
          </ToggleGroup>
        </OptionRow>
        {on && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">
              {t("chatWidth.widthLabel")}
            </span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={CHAT_WIDTH.min}
                max={CHAT_WIDTH.max}
                step={20}
                value={width}
                aria-label={t("chatWidth.widthLabel")}
                onChange={(e) => setChatMaxWidth(Number(e.target.value))}
                className="accent-primary w-36"
              />
              <span className="text-muted-foreground w-14 text-right text-xs tabular-nums">
                {width}px
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={width === CHAT_WIDTH.fallback}
                onClick={() => setChatMaxWidth(CHAT_WIDTH.fallback)}
              >
                {t("common.reset")}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

(`Card*`, `OptionRow`, `ToggleGroup`/`ToggleGroupItem`, `Button`, `useAppearance`, `useT` are all already imported/defined in this file.)

- [ ] **Step 4: Verify it compiles + lint + format**

Run: `npm run build && npm run lint && npm run format:check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/Appearance.tsx
git commit -m "feat(settings): add Chat width card (cap toggle + width slider)"
```

---

## Task 7: Full-suite verification + manual check

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite + build + lint**

Run: `npm test && npm run build && npm run lint && npm run format:check`
Expected: all PASS.

- [ ] **Step 2: Manual verification in the running app**

Run: `npm run tauri dev` (or `npm run tauri:dev` on Linux). Then confirm:
1. With default settings, a conversation column is capped (~760px) and centered when the window is wide; the composer lines up under it.
2. Resize the window narrow — the column fills the width with no centering (cap doesn't force a scrollbar / clipping).
3. Hover an assistant reply's meta row → the full-width (UnfoldHorizontal) button shows next to Copy. Click it → that reply expands to the container width; icon flips to FoldHorizontal; clicking again restores it. Neighbouring replies stay capped.
4. Settings → Appearance → Chat width: toggle **Off** → messages and composer span full width and the per-reply toggle disappears. Toggle **On** → cap returns at 760; drag the slider → column width changes live; Reset returns to 760.
5. Reload the app: the slider/on-off setting persists; per-reply full-width selections reset (expected — session-only).

- [ ] **Step 3: Final commit (only if Step 2 surfaced any fixups)**

```bash
git add -A
git commit -m "fix(chat): address chat max-width manual-test findings"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** §1 lib pref → Task 1; §2 store → Task 2; §3 MessageList centering + session state → Task 4 (steps 5–6); §4 ChatMessage/AssistantMeta toggle → Task 4 (steps 2–4); §5 composer alignment → Task 5; §6 i18n → Task 3; §7 settings card → Task 6; §8 tests → Task 1. All covered.
- **Type consistency:** `chatMaxWidth: number | null` and `setChatMaxWidth(v: number | null)` are identical across store (Task 2), MessageList/ChatView consumers (Tasks 4–5), and the settings card (Task 6). `CHAT_WIDTH` (`SizeRange`) is used consistently. `maxWidth?: number`, `wide?: boolean`, `onToggleWide?: () => void` match between `ChatMessage` and `AssistantMeta`.
- **Toggle visibility:** offered only when `capped` (cap on) — `onToggleWide` is `undefined` otherwise, so `AssistantMeta` renders no button. Streaming placeholder has empty `created_at`, so `AssistantMeta` returns null → no toggle until the reply is saved (intended).
- **Placeholder scan:** no TBD/TODO; every code step shows complete code; every run step has an exact command + expected result.
