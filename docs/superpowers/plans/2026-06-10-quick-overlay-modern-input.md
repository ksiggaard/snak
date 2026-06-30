> 📐 **Historical design doc.** A dated, point-in-time design record — kept for the
> rationale, not as current truth. For how the feature works today,
> [`AGENTS.md`](../../../AGENTS.md) is canonical; where this doc and the code disagree,
> the code wins.

# Modern Quick-Input Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the ALT+Space quick-input overlay in line with the new chat composer — auto-growing textarea, borderless ghost buttons, a model picker — with the overlay window growing to fit (Spotlight-style) and the chosen model carried into the new chat.

**Architecture:** Extract the model chooser into a controlled `ModelChooser` reused by both the chat (`ModelPicker` becomes a thin store-bound wrapper) and the overlay (local state). The overlay loads the plugin/model stores it needs, seeds its selection from the persisted default, and grows the `quick` window via a new Rust `set_quick_height` command driven by a `ResizeObserver`. The chosen provider/model rides the existing (opaque) `quick-submit` payload — no Rust payload change — and `App.tsx` applies it to the new thread before sending.

**Tech Stack:** React 19 + TypeScript, Tailwind v4 + shadcn/ui, Zustand, Tauri v2 (Rust), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-10-quick-overlay-modern-input-design.md`

> **Note on testing:** This feature is presentational + window/IPC glue with no new pure logic, so the per-task gate is `tsc`/ESLint/`cargo` + the existing Vitest suite (the `ModelChooser` extraction is behavior-preserving and stays covered by the `buildModelOptions`/`currentModelLabel` tests), with a manual verification pass at the end. No new unit tests are added — there is no new pure function that warrants one.

---

## Before you start

Continue on the existing branch `feat/composer-restyle` (the composer restyle this builds on is already committed there). Commit the spec + this plan first:

```bash
git checkout feat/composer-restyle
git add docs/superpowers/specs/2026-06-10-quick-overlay-modern-input-design.md docs/superpowers/plans/2026-06-10-quick-overlay-modern-input.md
git commit -m "docs: spec + plan for modern quick-input overlay"
```

## File structure

- `src/components/chat/ModelChooser.tsx` — **create**: controlled, presentational model chooser (all the dropdown/tooltip logic, props `{ provider, model, onSelect, align?, className? }`).
- `src/components/chat/ModelPicker.tsx` — **modify**: shrink to a store-bound wrapper around `ModelChooser` (keeps chat call sites unchanged).
- `src/store/threads.ts` — **modify**: export `DEFAULT_PROVIDER_KEY` / `DEFAULT_MODEL_KEY` (already-present constants; `resolveDefault` is already exported).
- `src/lib/quick.ts` — **modify**: extend `QuickPayload` with `provider`/`model`; add `setQuickHeight` wrapper.
- `src-tauri/src/commands/quick.rs` — **modify**: add `set_quick_height` command.
- `src-tauri/src/lib.rs` — **modify**: register `set_quick_height`.
- `src/components/QuickInput.tsx` — **modify**: restyle, add `ModelChooser` + local selection, load stores, seed default, `ResizeObserver` → `setQuickHeight`, reset height on submit/cancel, include `provider`/`model` in submit.
- `src/App.tsx` — **modify**: `quick-submit` handler applies `provider`/`model` before `send`.

---

## Task 1: Extract a controlled `ModelChooser`; make `ModelPicker` a wrapper

**Files:**
- Create: `src/components/chat/ModelChooser.tsx`
- Modify: `src/components/chat/ModelPicker.tsx`

Behavior-preserving refactor: move the chooser logic into a controlled component, leave the chat using `<ModelPicker/>` unchanged.

- [ ] **Step 1: Create `src/components/chat/ModelChooser.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { useModels } from "@/store/models";
import { useProviders } from "@/lib/providers";
import { buildModelOptions, currentModelLabel } from "@/lib/modelOptions";
import { hasApiKey } from "@/lib/keys";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Provider } from "@/types/db";

interface ModelChooserProps {
  provider: Provider;
  model: string;
  onSelect: (provider: Provider, model: string) => void;
  align?: "start" | "end";
  className?: string;
}

export function ModelChooser({
  provider,
  model,
  onSelect,
  align = "end",
  className,
}: ModelChooserProps) {
  const models = useModels((s) => s.models);

  // Active providers come from the enabled provider plugins (T18).
  const providers = useProviders();

  // Trigger label resolves synchronously (no `keyed` dependency) so the picker
  // renders immediately with no mount flash.
  const { label, providerLabel: currentProviderLabel } = currentModelLabel(
    providers,
    models,
    provider,
    model,
  );

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
              className={cn(
                "text-muted-foreground hover:text-foreground hover:bg-accent flex items-center gap-1 rounded-md px-2 py-1 text-sm transition-colors",
                className,
              )}
            >
              <span className="text-foreground max-w-40 truncate">{label}</span>
              <ChevronsUpDown className="size-3 shrink-0 opacity-60" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          {currentProviderLabel} · {model}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align={align}>
        {keyed === null ? (
          <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
        ) : (
          groups.map((g, gi) => (
            <DropdownMenuGroup key={g.providerLabel}>
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
                    onSelect={() => onSelect(o.provider, o.modelId)}
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
            </DropdownMenuGroup>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Replace `src/components/chat/ModelPicker.tsx` with a store-bound wrapper**

```tsx
import { useThreads } from "@/store/threads";
import { ModelChooser } from "@/components/chat/ModelChooser";

/** Store-bound model picker for the chat composer: reads the current thread's
 *  (or the draft's) provider+model and persists a change via the threads store.
 *  The presentational chooser lives in `ModelChooser` (also used by the overlay). */
export function ModelPicker() {
  const currentId = useThreads((s) => s.currentThreadId);
  const threads = useThreads((s) => s.threads);
  const draftProvider = useThreads((s) => s.draftProvider);
  const draftModel = useThreads((s) => s.draftModel);
  const setProviderModel = useThreads((s) => s.setProviderModel);

  const current = threads.find((t) => t.id === currentId);
  const provider = current?.provider ?? draftProvider;
  const model = current?.model ?? draftModel;

  return (
    <ModelChooser
      provider={provider}
      model={model}
      onSelect={(p, m) => void setProviderModel(p, m)}
    />
  );
}
```

- [ ] **Step 3: Verify build, lint, and existing tests**

Run: `npm run build && npm run lint && npx vitest run`
Expected: tsc clean, ESLint clean, all 183 tests pass (chat composer behavior unchanged — `<ModelPicker/>` still renders identically).

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/ModelChooser.tsx src/components/chat/ModelPicker.tsx
git commit -m "refactor: extract controlled ModelChooser; ModelPicker wraps it"
```

---

## Task 2: Rust `set_quick_height` command + TS wrapper

**Files:**
- Modify: `src-tauri/src/commands/quick.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/quick.ts`

Adds the native window-resize command (sizing stays in Rust) and its frontend wrapper. Unused until Task 3, so the app keeps working.

- [ ] **Step 1: Add the command to `src-tauri/src/commands/quick.rs`**

Change the existing `tauri` import at the top of the file:

```rust
use tauri::{AppHandle, Emitter, LogicalSize, Manager};
```

Then add this command (e.g. directly after the `hide_quick` command):

```rust
/// Resize the quick-input overlay to fit its content height (width is fixed).
/// Clamped so the overlay never collapses or grows past a sensible maximum;
/// the webview measures its content and calls this as the panel grows/shrinks.
#[tauri::command]
pub fn set_quick_height(app: AppHandle, height: f64) {
    const WIDTH: f64 = 640.0;
    const MIN: f64 = 160.0;
    const MAX: f64 = 480.0;
    if let Some(w) = app.get_webview_window("quick") {
        let _ = w.set_size(LogicalSize::new(WIDTH, height.clamp(MIN, MAX)));
    }
}
```

- [ ] **Step 2: Register it in `src-tauri/src/lib.rs`**

In the `tauri::generate_handler![ … ]` list, add the new command after `commands::quick::take_screenshot,`:

```rust
            commands::quick::take_screenshot,
            commands::quick::set_quick_height,
```

- [ ] **Step 3: Add the TS wrapper to `src/lib/quick.ts`**

Add this export (place it near `hideQuick`):

```ts
/** Resize the overlay window to fit `height` px of content (Rust clamps it). */
export const setQuickHeight = (height: number): Promise<void> =>
  invoke("set_quick_height", { height });
```

- [ ] **Step 4: Verify Rust + frontend compile**

Run (Rust needs cargo on PATH):
```bash
( cd src-tauri && PATH="$HOME/.cargo/bin:$PATH" cargo build && PATH="$HOME/.cargo/bin:$PATH" cargo clippy )
npm run build && npm run lint
```
Expected: `cargo build` succeeds, `cargo clippy` reports no new warnings for `quick.rs`/`lib.rs`, tsc clean, ESLint clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/quick.rs src-tauri/src/lib.rs src/lib/quick.ts
git commit -m "feat: set_quick_height command to grow the overlay window to fit"
```

---

## Task 3: Restyle `QuickInput` (auto-grow, ghost buttons, model picker, grow-to-fit)

**Files:**
- Modify: `src/store/threads.ts` (export two constants)
- Modify: `src/lib/quick.ts` (extend `QuickPayload`)
- Modify: `src/components/QuickInput.tsx` (the restyle)

- [ ] **Step 1: Export the default-model setting keys from `src/store/threads.ts`**

Find (around lines 31–32):

```ts
const DEFAULT_PROVIDER_KEY = "default_provider";
const DEFAULT_MODEL_KEY = "default_model";
```

Replace with (add `export`):

```ts
export const DEFAULT_PROVIDER_KEY = "default_provider";
export const DEFAULT_MODEL_KEY = "default_model";
```

(No other change — `resolveDefault` is already exported.)

- [ ] **Step 2: Extend `QuickPayload` in `src/lib/quick.ts`**

At the top of the file, add a `Provider` import:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { PreparedImage } from "@/lib/image";
import type { Provider } from "@/types/db";
```

And extend the interface:

```ts
/** Payload sent from the quick-input overlay to the main window. */
export interface QuickPayload {
  text: string;
  images: PreparedImage[];
  provider: Provider;
  model: string;
}
```

- [ ] **Step 3: Replace `src/components/QuickInput.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Camera, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ModelChooser } from "@/components/chat/ModelChooser";
import { prepareImage, type PreparedImage } from "@/lib/image";
import { hideQuick, submitQuick, takeScreenshot, setQuickHeight } from "@/lib/quick";
import { getSetting } from "@/lib/db";
import {
  DEFAULT_PROVIDER_KEY,
  DEFAULT_MODEL_KEY,
  resolveDefault,
} from "@/store/threads";
import { usePlugins } from "@/store/plugins";
import { useModels } from "@/store/models";
import { PROVIDERS } from "@/lib/providers";
import type { Provider } from "@/types/db";

/** Overlay window minimum height (matches the Rust clamp floor). */
const QUICK_MIN_HEIGHT = 160;

async function screenshotToImage(base64Png: string): Promise<PreparedImage> {
  const res = await fetch(`data:image/png;base64,${base64Png}`);
  return prepareImage(await res.blob());
}

export function QuickInput() {
  const [text, setText] = useState("");
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider>(PROVIDERS[0].id);
  const [model, setModel] = useState<string>(PROVIDERS[0].defaultModel);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // This window doesn't run App's init, so load the data the model chooser needs
  // (enabled providers + models), and seed the selection from the persisted default.
  useEffect(() => {
    void usePlugins.getState().load();
    void useModels.getState().load();
    void Promise.all([
      getSetting(DEFAULT_PROVIDER_KEY),
      getSetting(DEFAULT_MODEL_KEY),
    ]).then(([dp, dm]) => {
      const def = resolveDefault(dp, dm);
      setProvider(def.provider);
      setModel(def.model);
    });
  }, []);

  // Focus the field whenever the overlay gains focus (i.e. each time it's shown).
  useEffect(() => {
    textareaRef.current?.focus();
    const unlisten = getCurrentWindow().onFocusChanged(({ payload }) => {
      if (payload) textareaRef.current?.focus();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // Grow the overlay window to fit the panel (Rust clamps to [min, max]). Fires
  // on mount and on every content change (textarea growth, previews, error).
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // +16 accounts for the p-2 margin around the panel (8px top + bottom).
      void setQuickHeight(el.offsetHeight + 16);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  async function addFiles(files: Iterable<File>) {
    const imageFiles = Array.from(files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (imageFiles.length === 0) return;
    const prepared = await Promise.all(imageFiles.map((f) => prepareImage(f)));
    setImages((prev) => [...prev, ...prepared]);
  }

  async function screenshot() {
    setBusy(true);
    setError(null);
    try {
      const base64 = await takeScreenshot();
      if (base64) {
        const img = await screenshotToImage(base64);
        setImages((prev) => [...prev, img]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      textareaRef.current?.focus();
    }
  }

  function reset() {
    setText("");
    setImages([]);
    setError(null);
    void setQuickHeight(QUICK_MIN_HEIGHT);
  }

  async function submit() {
    const trimmed = text.trim();
    if (busy || (!trimmed && images.length === 0)) return;
    await submitQuick({ text: trimmed, images, provider, model });
    reset();
  }

  async function cancel() {
    reset();
    await hideQuick();
  }

  return (
    <div className="flex h-screen items-start justify-center p-2">
      <div
        ref={panelRef}
        className="bg-popover text-popover-foreground flex w-full flex-col gap-2 rounded-xl border p-3 shadow-2xl"
      >
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => (
              <div key={i} className="relative">
                <img
                  src={img.dataUrl}
                  alt="attachment preview"
                  className="size-14 rounded-md object-cover"
                />
                <button
                  type="button"
                  aria-label="Remove image"
                  onClick={() =>
                    setImages((prev) => prev.filter((_, j) => j !== i))
                  }
                  className="bg-background/80 absolute -top-1.5 -right-1.5 rounded-full border p-0.5"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-destructive px-1 text-xs">{error}</p>}

        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.some((f) => f.type.startsWith("image/"))) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              void cancel();
            }
          }}
          placeholder="Ask anything…  (Enter to start a chat, Esc to dismiss)"
          className="max-h-[320px] resize-none border-0 shadow-none focus-visible:ring-0"
          autoFocus
        />

        <div className="flex items-center gap-2">
          <ImagePicker onFiles={addFiles} disabled={busy} />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Take screenshot"
            disabled={busy}
            onClick={() => void screenshot()}
          >
            <Camera className="size-4" />
          </Button>
          <div className="flex-1" />
          <ModelChooser
            provider={provider}
            model={model}
            onSelect={(p, m) => {
              setProvider(p);
              setModel(m);
            }}
          />
          <Button
            onClick={() => void submit()}
            disabled={busy || (text.trim().length === 0 && images.length === 0)}
          >
            Start chat
          </Button>
        </div>
      </div>
    </div>
  );
}

function ImagePicker({
  onFiles,
  disabled,
}: {
  onFiles: (files: Iterable<File>) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label="Attach image"
        disabled={disabled}
        onClick={() => ref.current?.click()}
      >
        <Paperclip className="size-4" />
      </Button>
    </>
  );
}
```

> Notes: the textarea keeps its borderless styling (`border-0 shadow-none focus-visible:ring-0`) since the panel is the visible box; `rows={3}` is dropped and `max-h-[320px] resize-none` added so it auto-grows (via the base `field-sizing-content`) then scrolls. The Attach/Camera buttons are now `variant="ghost"`. `ModelChooser` is controlled by local `provider`/`model` state, seeded from the persisted default. The `ResizeObserver` drives `setQuickHeight`. If the textarea doesn't auto-grow in the target webview, apply the same JS fallback documented in the composer-restyle plan (Task 5) to this textarea.

- [ ] **Step 4: Verify build, lint, and tests**

Run: `npm run build && npm run lint && npx vitest run`
Expected: tsc clean, ESLint clean, 183 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/store/threads.ts src/lib/quick.ts src/components/QuickInput.tsx
git commit -m "feat: modern quick-input overlay (auto-grow, ghost buttons, model picker, grow-to-fit)"
```

---

## Task 4: Apply the overlay's model in the `quick-submit` handler

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update the `quick-submit` effect**

Find (around lines 80–92):

```tsx
  useEffect(() => {
    const { startNewChat, send } = useThreads.getState();
    const unlisten = listen<QuickPayload>("quick-submit", (e) => {
      useProjects.getState().close();
      useView.getState().showChat();
      setMobileOpen(false);
      startNewChat();
      void send(e.payload.text, e.payload.images);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);
```

Replace with:

```tsx
  useEffect(() => {
    const { startNewChat, send, setProviderModel } = useThreads.getState();
    const unlisten = listen<QuickPayload>("quick-submit", (e) => {
      useProjects.getState().close();
      useView.getState().showChat();
      setMobileOpen(false);
      startNewChat();
      // Apply the model chosen in the overlay to the fresh draft (set
      // synchronously when there's no current thread) so the new thread uses it.
      if (e.payload.provider && e.payload.model) {
        void setProviderModel(e.payload.provider, e.payload.model);
      }
      void send(e.payload.text, e.payload.images);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: tsc clean, ESLint clean.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: quick-submit uses the model chosen in the overlay"
```

---

## Task 5: Manual verification in the running app

**Files:** none (verification). Applies the textarea JS fallback only if needed.

- [ ] **Step 1: Launch the app**

Run (cargo must be on PATH): `PATH="$HOME/.cargo/bin:$PATH" npm run tauri dev`
(If port 1420 is already in use, an instance is already running and Vite has hot-reloaded the frontend; restart the Rust side only if you changed Rust — Task 2 did, so a fresh `tauri dev` is needed to pick up `set_quick_height`.)

- [ ] **Step 2: Verify the acceptance criteria**

1. Press **Alt+Space** (Option+Space): the overlay appears compact, textarea focused.
2. The overlay matches the chat composer: borderless 📎/📷 buttons, and a `<model> ⌄` picker in the bar before "Start chat".
3. Type/paste a long multi-paragraph message: the **overlay window grows taller** to fit, up to ~480px, then the textarea **scrolls** internally.
4. Hover the model text → tooltip shows `provider · model-id`. Click → grouped dropdown; the seeded default is checked. Pick a different model.
5. Press Enter (or "Start chat"): the main window focuses and a **new thread is created on the model you picked** in the overlay (verify the chat's model picker shows that model).
6. Re-summon with Alt+Space: the overlay is **compact again** (height reset) and focused.
7. Screenshot (📷) and image attach/paste still add previews and submit correctly.

- [ ] **Step 3: Auto-grow contingency (only if Step 2.3's textarea doesn't grow)**

If the textarea doesn't grow (webview lacks CSS `field-sizing`), add JS sizing to `QuickInput.tsx`: change the React import to include `useLayoutEffect`, add

```tsx
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [text]);
```

and add `overflow-y-auto [field-sizing:fixed]` to the textarea's className. Re-run `npm run build && npm run lint`, repeat Step 2.3, then:

```bash
git add src/components/QuickInput.tsx
git commit -m "fix: JS auto-grow fallback for the overlay textarea"
```

- [ ] **Step 4: Full sweep**

Run: `npm run test && npm run build && npm run lint` and `( cd src-tauri && PATH="$HOME/.cargo/bin:$PATH" cargo clippy )`
Expected: all green (no new clippy warnings). The branch is then ready to finish (merge/PR into `feat/snak-and-fixes`) via the `superpowers:finishing-a-development-branch` skill, together with the composer-restyle work.
```
