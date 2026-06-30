> 📐 **Historical design doc.** A dated, point-in-time design record — kept for the
> rationale, not as current truth. For how the feature works today,
> [`AGENTS.md`](../../../AGENTS.md) is canonical; where this doc and the code disagree,
> the code wins.

# Composer restyle: reclaim chat height, model picker as toolbar text + dropdown, auto-growing input

**Date:** 2026-06-10
**Status:** Design — pending review

## Problem

The chat composer wastes vertical space and surfaces the model picker more prominently than it needs to be:

- The `ModelPicker` (`src/components/chat/ModelPicker.tsx`) is a full `<select>` that occupies its **own dedicated row** above the input (`Composer.tsx`, the `min-h-9` wrapper). That row costs ~44px on every chat, permanently, even though the model rarely changes mid-conversation.
- The textarea is fixed at `rows={2}` with `max-h-40` and does not grow naturally with the message being typed.
- The toolbar uses outlined (`variant="outline"`) icon buttons, which read heavier than the lightweight, content-first composer the user wants.

The user supplied a reference composer they like: a single rounded panel with the textarea on top, a borderless controls bar along the bottom, and the active model shown as compact muted text + chevron at the bottom-right.

## Goals

1. **Reclaim vertical height** so the message history grows upward — primarily by removing the dedicated model-picker row and letting the composer be more compact.
2. **Relocate the model selector** into the bottom controls bar as compact muted text (`<model label> ⌄`); hover shows the full `provider · model-id`; click opens a chooser.
3. **Two-tier, borderless composer** matching the reference: textarea full-width on top, ghost-style controls bar below.
4. **Auto-growing textarea**: starts ~2 rows, grows upward as the user types, caps at ~260px (~10–12 lines), then scrolls internally.
5. **Chooser = anchored popover** rising from the model text, grouped by provider, current model checked.

## Non-goals (out of scope)

- The reasoning-effort ("High") control and mic/voice icons from the reference image — not features of this app.
- A search/filter input inside the chooser — deferred; current model lists are short (a handful per provider). Revisit if lists grow.
- The `QuickInput` overlay textarea (`src/components/QuickInput.tsx`) — a separate input; left unchanged.
- `ProjectView` — a project editor, not a chat composer; unaffected.
- Changing the Send button into an arrow-icon button — keep the text "Send" button as today.

## Design

### 1. Composer layout — two-tier rounded panel

`src/components/chat/Composer.tsx` is restructured from a single `items-end` row (buttons + textarea + send inline, with a dedicated picker row above) into a **two-tier panel**:

```
┌─ composer panel (bg-card, rounded-xl, border, p-3) ──────────┐
│  [Canvas?]  [warnings?]  [attachError?]  [slash palette?]     │  ← existing aux blocks, unchanged,
│  [pending-command gate?]  [image previews?]                   │     rendered above the textarea
│                                                               │
│  ┌─ Textarea (full width, auto-grow, max-h ~260px) ────────┐  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  [📎 ghost] [⛶ ghost]            [Opus 4.8 ⌄]   [ Send ]      │  ← controls bar: flex items-center gap-2
└───────────────────────────────────────────────────────────────┘
```

Specific changes in `Composer.tsx`:

- **Remove** the dedicated model-picker row (`<div className="flex min-h-9 items-center"><ModelPicker /></div>`).
- **Outer container** becomes the rounded panel: `bg-card flex flex-col gap-2 rounded-xl border p-3` (keep the existing `onDragOver`/`onDrop`). It was previously `flex flex-col gap-2 border-t p-3` (a section of the chat card divided by a top border).
- The aux blocks (Canvas, provider-disabled / no-key warnings, `attachError`, slash-command palette, pending-command confirmation gate, image previews) keep their current markup and stay **above** the textarea.
- **Textarea** moves to its own full-width block (see §2).
- **Controls bar** below the textarea: `flex items-center gap-2`.
  - Attach button and Canvas button change from `variant="outline"` to `variant="ghost"` (borderless), `size="icon"`. Icons unchanged (`Paperclip`, `Maximize2`).
  - `<div className="flex-1" />` spacer pushes the rest to the right.
  - `<ModelPicker />` (rewritten, §3) renders the compact text trigger here.
  - Send / Stop button stays on the far right (unchanged logic: `busy` → destructive "Stop", else primary "Send" gated by `canSend`).

### 2. Auto-growing textarea

The shadcn `Textarea` (`src/components/ui/textarea.tsx`) already opts into CSS `field-sizing-content` and `min-h-16`. Today's Composer suppresses that with `rows={2}` and `max-h-40 min-h-0`.

**Primary approach (CSS, minimal):**
- Drop `rows={2}` and the `min-h-0` override.
- Set the className to `max-h-[260px] resize-none` (the base `min-h-16` ≈ 2 lines becomes the floor; `field-sizing-content` grows it with content up to the cap; the textarea's default `overflow-y:auto` scrolls past the cap).
- Because the composer is the bottom element of a flex column with the message list as `flex-1` above it, growth pushes the composer's top edge **up** automatically — "grow upwards" needs no extra code.

**Verification + fallback:** Confirm growth works in the running app (macOS WKWebView). `field-sizing` is recent; if the KDE/WebKitGTK target (Linux packaging is already deferred — see T5) does not honor it, switch this one textarea to JS sizing — a ref is available (the shadcn `Textarea` forwards `ref` under React 19; `QuickInput.tsx` already relies on this):

```tsx
const taRef = useRef<HTMLTextAreaElement>(null);
useLayoutEffect(() => {
  const el = taRef.current;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
}, [text]);
// + className gets `[field-sizing:fixed] overflow-y-auto` so inline height fully controls sizing.
```

`useLayoutEffect` keyed on `text` covers every path that mutates the value (typing, slash-command insertion, send-clear, canvas sync). Measuring `scrollHeight` in a layout effect is DOM measurement, not the `setState`-in-effect pattern the repo's lint rule forbids.

### 3. Model selector — `ModelPicker` rewrite (trigger + dropdown chooser)

Rewrite `src/components/chat/ModelPicker.tsx`. The pure builder `buildModelOptions` (`src/lib/modelOptions.ts`) and the async `keyed` (which providers have a stored API key) resolution are **kept as-is**. The `<select>` is replaced with a Radix **DropdownMenu** (`src/components/ui/dropdown-menu.tsx`, already installed — no new dependency; gives grouping, checkmarks, keyboard nav, and anchored positioning for free) plus a hover **Tooltip** (`src/components/ui/tooltip.tsx`, already installed; the app root already provides a `TooltipProvider`).

**Trigger** (rendered in the controls bar): a ghost button showing the current model's short **`label`** + a chevron (`lucide-react` `ChevronsUpDown` or `ChevronDown`), styled muted (`text-muted-foreground`, hover `text-foreground`). The current label is resolved synchronously from the models store and provider list — independent of `keyed` — so the trigger renders immediately with no mount flash (today's `if (keyed === null) return null` is replaced):

```
currentLabel    = models.find(m => m.provider === provider && m.model_id === model)?.label ?? model;
currentProvLabel = providers.find(p => p.id === provider)?.label ?? provider;  // fallback if provider disabled
```

**Tooltip** on the trigger: `"{currentProvLabel} · {model}"` (full provider name + raw model id). Wrap with `Tooltip`/`TooltipTrigger asChild` composed with `DropdownMenuTrigger asChild`; opening the menu should suppress the tooltip. If the Radix trigger composition proves fiddly, fall back to a native `title` attribute carrying the same string.

**Chooser content** (the dropdown): built from `buildModelOptions(providers, keyed, models, { provider, model })`, grouped by provider:
- A `DropdownMenuLabel` header per provider (`providerLabel`).
- A `DropdownMenuItem` per model showing `label`; the active selection (`o.provider === provider && o.modelId === model`) gets a leading `Check` icon (others get an equal-width spacer for alignment).
- The inert injected current entry (`active === false` — a since-disabled / no-key current combo) renders disabled with a muted "unavailable" suffix, mirroring today's `" (unavailable)"`.
- On select: `setProviderModel(opt.provider, opt.modelId)` and close.

Because `buildModelOptions` only emits models for **enabled + keyed** providers (plus the inert current entry), the chooser naturally lists only usable models — same gating as today's `<select>`, no regression. There is intentionally no way to pick an unkeyed provider here (consistent with current behavior; keys are added in Settings).

**States:**
- `keyed === null` (resolving): trigger renders with the current label; if the menu is opened before resolution, show a single disabled "Loading…" item.
- `options.length === 0` (no enabled+keyed providers / no models): trigger renders as muted, non-interactive text "No model — add an API key in Settings" (preserves today's guidance message; the dedicated reserved row is gone, so this lives inline in the bar).

### 4. ChatView chrome — **decision flagged for review**

To make the composer panel read as the single bordered element (matching the reference, where history floats on the background), `src/components/chat/ChatView.tsx` drops the outer card chrome:

- Was: `<div className="bg-card flex flex-1 flex-col overflow-hidden rounded-lg border">`.
- Becomes: `<div className="flex flex-1 flex-col gap-3 overflow-hidden">` — `MessageList` (still `flex-1`, scrolls) floats on `bg-background`; the `Composer` panel (its own `bg-card`/border from §1) is separated by `gap-3`.
- The error line loses its floating `border-t`; render it as muted destructive text just above the composer (`text-destructive px-1 text-sm`).

This is a slightly broader visual change than strictly required and directly serves "more height" (less chrome). It matches the approved mockups. **If you'd prefer to keep the existing chat card**, we instead keep ChatView as-is and only restyle the composer internals (the composer becomes an inner rounded panel inside the card). Calling this out explicitly so it can be vetoed in review.

## Files touched

- `src/components/chat/Composer.tsx` — two-tier layout, ghost buttons, remove picker row, auto-grow textarea, render `ModelPicker` in the bar.
- `src/components/chat/ModelPicker.tsx` — rewrite from `<select>` to DropdownMenu trigger + grouped chooser + tooltip; render trigger immediately (no null flash).
- `src/components/chat/ChatView.tsx` — drop card chrome, `gap-3`, error placement (pending §4 decision).
- (Possibly) a tiny pure helper `currentModelLabel(models, providers, provider, model)` extracted for unit testing, following the repo's "pure fn + unit test" convention.

No Rust/backend changes. No DB/migration changes. No changes to `buildModelOptions`, the providers registry, or the streaming path.

## Edge cases / states to preserve

- Provider disabled / no providers enabled → existing warning text (now above the textarea).
- No API key for the selected provider → existing warning text.
- `busy` → "Stop" button + `ChatView`'s "Thinking…" until first token (unchanged).
- Canvas open, slash-command palette, pending-command confirmation gate, image previews → unchanged markup, all above the textarea.
- Drag-and-drop / paste image flows → unchanged (handlers stay on the panel).
- Mount with unresolved keys → trigger shows current label, no layout shift.

## Testing

- **Unit:** if the `currentModelLabel` helper is extracted, add a focused test (resolves a known model's label; falls back to the raw model id when the model/provider is absent — e.g. a since-disabled provider). `buildModelOptions` tests are untouched.
- **Manual (run the app):**
  1. Picker row is gone; message area is visibly taller.
  2. Typing a long message grows the textarea upward to ~260px, then it scrolls internally; the controls bar stays pinned.
  3. Model shows as compact text; hovering shows the full `provider · model-id`; clicking opens a grouped dropdown with the current model checked; selecting switches the active model (and persists for a saved thread).
  4. Empty / no-key states render the guidance inline without shifting the bar.
- **Lint/typecheck:** `npm run lint`, `npm run build`.

## Open decision for review

- **ChatView chrome (§4):** drop the outer card so history floats and the composer is the lone panel (recommended, matches the reference), **or** keep the card and only restyle the composer internals.
