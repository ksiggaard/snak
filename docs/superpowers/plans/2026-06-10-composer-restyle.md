# Composer Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reclaim chat height by turning the composer into a two-tier panel — an auto-growing textarea over a borderless controls bar — and relocate the model picker into that bar as compact text that opens a grouped dropdown chooser.

**Architecture:** Pure UI change in the React layer. A new pure helper resolves the current model's display label (unit-tested). `ModelPicker` is rewritten from a `<select>` to a Radix DropdownMenu trigger + grouped chooser with a hover tooltip. `Composer` is restructured into a rounded panel (textarea on top, ghost-icon controls bar below) and its textarea auto-grows. `ChatView` drops its outer card so the composer panel is the lone bordered element. No Rust/DB/streaming changes; `buildModelOptions` and key-gating logic are untouched.

**Tech Stack:** React 19 + TypeScript, Tailwind v4, shadcn/ui (Radix `dropdown-menu`, `tooltip`, `textarea`, `button` — all already installed), Vitest, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-06-10-composer-restyle-design.md`

---

## Before you start

Current branch is `main` (the default). Create a feature branch first:

```bash
git checkout -b feat/composer-restyle
git add docs/superpowers/specs/2026-06-10-composer-restyle-design.md docs/superpowers/plans/2026-06-10-composer-restyle.md
git commit -m "docs: spec + plan for composer restyle"
```

## File structure

- `src/lib/modelOptions.ts` — **modify**: add the pure `currentModelLabel` helper next to `buildModelOptions`.
- `src/lib/modelOptions.test.ts` — **modify**: append tests for `currentModelLabel`.
- `src/components/chat/ModelPicker.tsx` — **rewrite**: `<select>` → DropdownMenu trigger + grouped chooser + tooltip.
- `src/components/chat/Composer.tsx` — **modify**: two-tier panel, ghost buttons, remove the dedicated picker row, render `ModelPicker` in the controls bar, auto-grow textarea.
- `src/components/chat/ChatView.tsx` — **rewrite (small)**: drop outer card chrome; reposition error line.

---

## Task 1: `currentModelLabel` pure helper

**Files:**
- Modify: `src/lib/modelOptions.ts` (append after `buildModelOptions`)
- Test: `src/lib/modelOptions.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/lib/modelOptions.test.ts` (the `provider`, `model`, `providers`, `models` factories already exist at the top of the file — reuse them; add `currentModelLabel` to the import on line 2):

```ts
describe("currentModelLabel", () => {
  it("returns the model's friendly label and provider label", () => {
    expect(currentModelLabel(providers, models, "anthropic", "claude-opus-4-8")).toEqual({
      label: "Opus 4.8",
      providerLabel: "Anthropic",
    });
  });

  it("falls back to the raw model id and provider id when not found", () => {
    expect(currentModelLabel(providers, models, "anthropic", "claude-unknown")).toEqual({
      label: "claude-unknown",
      providerLabel: "Anthropic",
    });
    expect(currentModelLabel([], [], "mistral", "mistral-large-latest")).toEqual({
      label: "mistral-large-latest",
      providerLabel: "mistral",
    });
  });
});
```

Update the import line at the top of the file:

```ts
import { buildModelOptions, currentModelLabel } from "@/lib/modelOptions";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/modelOptions.test.ts`
Expected: FAIL — `currentModelLabel is not a function` / import error.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/modelOptions.ts`:

```ts
/** The display strings for the currently-selected provider+model. Pure; resolves
 *  synchronously from the models list + provider registry (no key lookup), so the
 *  picker trigger can render immediately without a mount flash. Falls back to the
 *  raw ids when the model/provider isn't found (e.g. a since-disabled provider). */
export function currentModelLabel(
  providers: ProviderMeta[],
  models: Model[],
  provider: Provider,
  model: string,
): { label: string; providerLabel: string } {
  const m = models.find((x) => x.provider === provider && x.model_id === model);
  const p = providers.find((x) => x.id === provider);
  return {
    label: m?.label ?? model,
    providerLabel: p?.label ?? provider,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/modelOptions.test.ts`
Expected: PASS (all `buildModelOptions` + `currentModelLabel` tests green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/modelOptions.ts src/lib/modelOptions.test.ts
git commit -m "feat: add currentModelLabel helper for the model picker trigger"
```

---

## Task 2: Rewrite `ModelPicker` as a dropdown chooser

**Files:**
- Rewrite: `src/components/chat/ModelPicker.tsx`

Replaces the `<select>` with a compact text trigger (`label ⌄`) that opens a Radix DropdownMenu grouped by provider, with a hover tooltip showing the full `provider · model-id`. Renders the trigger immediately (no `keyed === null → return null` flash). Note: `buildModelOptions` always injects the current combo as an inert entry when it isn't otherwise present, so the list is never empty while a thread/draft has a provider+model — the "no models" case surfaces as a single disabled "unavailable" entry, and the composer's own no-key/disabled warnings (unchanged) provide the guidance.

- [ ] **Step 1: Replace the file contents**

Write `src/components/chat/ModelPicker.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { useThreads } from "@/store/threads";
import { useModels } from "@/store/models";
import { useProviders } from "@/lib/providers";
import { buildModelOptions, currentModelLabel } from "@/lib/modelOptions";
import { hasApiKey } from "@/lib/keys";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Provider } from "@/types/db";

export function ModelPicker() {
  const currentId = useThreads((s) => s.currentThreadId);
  const threads = useThreads((s) => s.threads);
  const draftProvider = useThreads((s) => s.draftProvider);
  const draftModel = useThreads((s) => s.draftModel);
  const setProviderModel = useThreads((s) => s.setProviderModel);
  const models = useModels((s) => s.models);

  // Active providers come from the enabled provider plugins (T18).
  const providers = useProviders();

  const current = threads.find((t) => t.id === currentId);
  const provider = current?.provider ?? draftProvider;
  const model = current?.model ?? draftModel;

  // Trigger label resolves synchronously (no `keyed` dependency) so the picker
  // renders immediately with no mount flash.
  const { label, providerLabel } = currentModelLabel(providers, models, provider, model);

  // Which enabled providers have a stored API key. Resolved async (like
  // ApiKeys.tsx); recomputed when the provider list changes.
  const [keyed, setKeyed] = useState<Set<Provider> | null>(null);
  const providerKey = providers.map((p) => p.id).join(",");
  useEffect(() => {
    let active = true;
    void Promise.all(
      providers.map((p) => hasApiKey(p.id).then((ok) => [p.id, ok] as const)),
    )
      .then((pairs) => {
        if (active) setKeyed(new Set(pairs.filter(([, ok]) => ok).map(([id]) => id)));
      })
      .catch(() => {
        if (active) setKeyed(new Set());
      });
    return () => {
      active = false;
    };
    // providerKey captures the provider-list identity (primitive, stable).
  }, [providerKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const options =
    keyed === null ? [] : buildModelOptions(providers, keyed, models, { provider, model });

  // Group options by provider for the chooser, preserving option order.
  const groups: { providerLabel: string; items: typeof options }[] = [];
  for (const o of options) {
    const g = groups.find((x) => x.providerLabel === o.providerLabel);
    if (g) g.items.push(o);
    else groups.push({ providerLabel: o.providerLabel, items: [o] });
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Choose model"
              className="text-muted-foreground hover:text-foreground hover:bg-accent flex items-center gap-1 rounded-md px-2 py-1 text-sm transition-colors"
            >
              <span className="text-foreground max-w-40 truncate">{label}</span>
              <ChevronsUpDown className="size-3 shrink-0 opacity-60" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          {providerLabel} · {model}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
        {keyed === null ? (
          <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
        ) : (
          groups.map((g, gi) => (
            <div key={g.providerLabel}>
              {gi > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-muted-foreground text-xs">
                {g.providerLabel}
              </DropdownMenuLabel>
              {g.items.map((o) => {
                const selected = o.provider === provider && o.modelId === model;
                return (
                  <DropdownMenuItem
                    key={`${o.provider}:${o.modelId}`}
                    disabled={!o.active}
                    onSelect={() => void setProviderModel(o.provider, o.modelId)}
                  >
                    <Check
                      className={cn("size-4 shrink-0", selected ? "opacity-100" : "opacity-0")}
                    />
                    <span className="flex-1 truncate">{o.label}</span>
                    {!o.active && (
                      <span className="text-muted-foreground text-xs">unavailable</span>
                    )}
                  </DropdownMenuItem>
                );
              })}
            </div>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: PASS — no TS errors, no lint errors. (`ModelPicker` still renders in its current spot in `Composer`; the app remains functional after this task.)

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/ModelPicker.tsx
git commit -m "feat: model picker as a dropdown chooser with hover tooltip"
```

---

## Task 3: Restructure `Composer` into a two-tier panel with an auto-growing textarea

**Files:**
- Modify: `src/components/chat/Composer.tsx`

Three edits: (a) outer container → rounded panel; (b) remove the dedicated model-picker row; (c) split the old `items-end` toolbar row into a full-width textarea block + a borderless controls bar containing the relocated `ModelPicker`.

- [ ] **Step 1: Make the composer a rounded panel**

Find:

```tsx
    <div
      className="flex flex-col gap-2 border-t p-3"
      onDragOver={(e) => e.preventDefault()}
```

Replace with:

```tsx
    <div
      className="bg-card flex flex-col gap-2 rounded-xl border p-3"
      onDragOver={(e) => e.preventDefault()}
```

- [ ] **Step 2: Remove the dedicated model-picker row**

Find and delete this block (the comment + wrapper):

```tsx
      {/* Compact model picker relocated from the old header (T25) — kept right
          above the input so the active model is one glance/click from sending.
          Min height reserves space so the picker resolving from null→select
          doesn't shift the composer. */}
      <div className="flex min-h-9 items-center">
        <ModelPicker />
      </div>
```

- [ ] **Step 3: Split the toolbar into textarea + controls bar**

Find the toolbar block — the `<div className="flex items-end gap-2">` that wraps the hidden file input, the Attach button, the Canvas button, the `<Textarea>`, and the Send/Stop block (Composer.tsx around the `items-end` row). Replace the **whole** `<div className="flex items-end gap-2"> … </div>` with the following (hidden input first, then the full-width textarea, then the controls bar):

```tsx
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <Textarea
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          // Open the palette when the user starts a slash command; reset the
          // highlight to the top as the filter changes.
          setPaletteOpen(v.startsWith("/") && !v.startsWith("//"));
          setPaletteIndex(0);
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.some((f) => f.type.startsWith("image/"))) {
            e.preventDefault();
            void addFiles(files);
          }
        }}
        placeholder="Type a message…  ( / for commands · Enter to send · Shift+Enter for newline )"
        className="max-h-[260px] resize-none"
        onKeyDown={(e) => {
          // Palette navigation takes priority over send/newline.
          if (showPalette) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setPaletteIndex((i) => (i + 1) % matches.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setPaletteIndex((i) => (i - 1 + matches.length) % matches.length);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setPaletteOpen(false);
              return;
            }
            if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
              e.preventDefault();
              pickCommand(matches[Math.min(paletteIndex, matches.length - 1)]);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Attach image"
          disabled={composeDisabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open canvas"
          title="Open canvas — a larger editor with live Markdown preview"
          disabled={composeDisabled}
          onClick={() => setCanvasOpen(true)}
        >
          <Maximize2 className="size-4" />
        </Button>
        <div className="flex-1" />
        <ModelPicker />
        {busy ? (
          <Button
            type="button"
            variant="destructive"
            onClick={onCancel}
            aria-label="Stop generating"
          >
            <Square className="size-4" />
            Stop
          </Button>
        ) : (
          <Button onClick={send} disabled={!canSend}>
            Send
          </Button>
        )}
      </div>
```

> Notes: `rows={2}` and `min-h-0` are intentionally dropped — the shadcn `Textarea` base class carries `field-sizing-content` (auto-grows to content) and `min-h-16` (≈2-line floor); `max-h-[260px] resize-none` caps growth at ~10–12 lines and then scrolls internally. The `<Textarea>` keeps the same `value`/`onChange`/`onPaste`/`onKeyDown` handlers it had before — only its container position and className change.

- [ ] **Step 4: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: PASS — no TS/lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/Composer.tsx
git commit -m "feat: two-tier composer panel with borderless controls bar"
```

---

## Task 4: Drop `ChatView`'s outer card

**Files:**
- Rewrite: `src/components/chat/ChatView.tsx`

The composer is now its own bordered panel, so the surrounding card is redundant. Messages float on the background; a `gap-3` separates them from the composer panel. The error line loses its floating `border-t`.

- [ ] **Step 1: Edit the returned JSX**

In `src/components/chat/ChatView.tsx`, find:

```tsx
  return (
    <div className="bg-card flex flex-1 flex-col overflow-hidden rounded-lg border">
      <MessageList messages={messages} pending={pending} />
      {error && (
        <p className="text-destructive border-t px-4 py-2 text-sm">{error}</p>
      )}
      <Composer
```

Replace with:

```tsx
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-hidden">
      <MessageList messages={messages} pending={pending} />
      {error && <p className="text-destructive px-1 text-sm">{error}</p>}
      <Composer
```

(The `overflow-hidden` + `flex flex-1 flex-col` chain is preserved, so `MessageList`'s `flex-1 overflow-y-auto` scroll behavior is unchanged — only the `bg-card rounded-lg border` chrome is removed and `gap-3` added.)

- [ ] **Step 2: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/ChatView.tsx
git commit -m "feat: float chat history; composer panel is the lone bordered element"
```

---

## Task 5: Manual verification in the running app

**Files:** none (verification); applies the auto-grow contingency below only if needed.

- [ ] **Step 1: Launch the app**

Run: `npm run tauri dev`

- [ ] **Step 2: Verify the acceptance criteria**

Check each:
1. The dedicated model-picker row is gone; the message area is visibly taller than before.
2. The composer is a single rounded panel: textarea on top, a borderless bar below with `📎` / canvas icons on the left and `<model> ⌄` + `Send` on the right.
3. Typing a long multi-paragraph message grows the textarea **upward**; past ~260px it stops growing and scrolls internally; the controls bar stays pinned at the bottom.
4. The model text shows the active model's friendly label; hovering it shows a tooltip with the full `provider · model-id`.
5. Clicking the model text opens a dropdown grouped by provider, with a check on the current model; selecting another switches the active model (and persists for a saved thread — reopen the thread to confirm).
6. With no API key for the selected provider, the composer still shows its no-key guidance and the chooser lists the current model as a disabled "unavailable" entry.

- [ ] **Step 3: Auto-grow contingency (only if Step 2.3 fails)**

If the textarea does **not** grow with content (the target webview doesn't honor CSS `field-sizing`), switch this one textarea to JS sizing in `src/components/chat/Composer.tsx`:

1. Add `useLayoutEffect` and `useRef` to the React import (the file already imports `useRef`; add `useLayoutEffect`):

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from "react";
```

2. Inside the `Composer` component body, near the other refs, add:

```tsx
  const taRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [text]);
```

3. Add the ref + neutralize the CSS sizing on the `<Textarea>` (so inline height fully controls it):

```tsx
      <Textarea
        ref={taRef}
        value={text}
        // …handlers unchanged…
        className="max-h-[260px] resize-none overflow-y-auto [field-sizing:fixed]"
```

Then re-run `npm run build && npm run lint`, repeat Step 2.3, and commit:

```bash
git add src/components/chat/Composer.tsx
git commit -m "fix: JS auto-grow fallback for textarea where field-sizing is unsupported"
```

- [ ] **Step 4: Full test sweep + finish**

Run: `npm run test && npm run build && npm run lint`
Expected: all green. The feature branch `feat/composer-restyle` is ready to merge into `feat/snak-and-fixes` (use the `superpowers:finishing-a-development-branch` skill to open the PR / merge).
```
