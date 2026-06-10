# Configurable Default Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick a persisted default provider + model that seeds every new interaction (new chats and the quick-input overlay), configured from a Settings section.

**Architecture:** Persist `default_provider` / `default_model` in the SQLite `settings` table. The threads store caches them (`defaultProvider` / `defaultModel`), loads them in `init()`, seeds the draft from them, resets the draft to them on `startNewChat`, and exposes a `setDefaultModel` action. A new `DefaultModel` settings card edits them, wired into the existing `SettingsView` nav.

**Tech Stack:** React 19, TypeScript, Zustand, Tailwind v4 + shadcn/ui, Vitest. Commands run from repo root.

---

### Task 1: `resolveDefault` pure helper

Resolves the stored settings strings into a concrete `{ provider, model }`, falling back to `PROVIDERS[0]` when either is absent. Pure and unit-tested (mirrors `deriveTitle`).

**Files:**
- Modify: `src/store/threads.ts` (add export near `deriveTitle`, ~line 40)
- Test: `src/store/threads.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/store/threads.test.ts`. Change the import on line 2 to also import `resolveDefault`, and add the `PROVIDERS` import:

```ts
import { describe, it, expect } from "vitest";
import { deriveTitle, resolveDefault } from "@/store/threads";
import { PROVIDERS } from "@/lib/providers";
```

Then append this describe block at the end of the file:

```ts
describe("resolveDefault", () => {
  it("uses the stored provider+model when both are present", () => {
    expect(resolveDefault("openai", "gpt-4o")).toEqual({
      provider: "openai",
      model: "gpt-4o",
    });
  });

  it("falls back to PROVIDERS[0] when the provider is missing", () => {
    expect(resolveDefault(null, "gpt-4o")).toEqual({
      provider: PROVIDERS[0].id,
      model: PROVIDERS[0].defaultModel,
    });
  });

  it("falls back to PROVIDERS[0] when the model is missing", () => {
    expect(resolveDefault("openai", null)).toEqual({
      provider: PROVIDERS[0].id,
      model: PROVIDERS[0].defaultModel,
    });
  });

  it("falls back to PROVIDERS[0] when both are missing", () => {
    expect(resolveDefault(null, null)).toEqual({
      provider: PROVIDERS[0].id,
      model: PROVIDERS[0].defaultModel,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/store/threads.test.ts`
Expected: FAIL — `resolveDefault is not a function` / no export named `resolveDefault`.

- [ ] **Step 3: Implement `resolveDefault`**

In `src/store/threads.ts`, add immediately after the `deriveTitle` function (after line 40):

```ts
/** The default provider+model for new interactions. */
export interface DefaultModel {
  provider: Provider;
  model: string;
}

/**
 * Resolve the persisted default (the `default_provider` / `default_model`
 * settings strings) into a concrete provider+model, falling back to the first
 * built-in provider when unset. Pure. The two keys are always written together
 * by `setDefaultModel`, so they are either both present or both absent.
 */
export function resolveDefault(
  provider: string | null,
  model: string | null,
): DefaultModel {
  if (provider && model) return { provider: provider as Provider, model };
  return { provider: PROVIDERS[0].id, model: PROVIDERS[0].defaultModel };
}
```

(`Provider` and `PROVIDERS` are already imported at the top of the file.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/store/threads.test.ts`
Expected: PASS (all `deriveTitle` and `resolveDefault` tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/threads.ts src/store/threads.test.ts
git commit -m "Add resolveDefault helper for default model fallback"
```

---

### Task 2: Store state, init seeding, draft reset, and `setDefaultModel`

Add the cached default to the store, load it in `init()`, seed/reset the draft from it, and add the persist action.

**Files:**
- Modify: `src/store/threads.ts` (constants ~line 29; interface ~line 42; initial state ~line 138; `init` ~line 146; `startNewChat` ~line 170; `startNewChatInProject` ~line 179; add `setDefaultModel` action)
- Test: `src/store/threads.defaultModel.test.ts` (create)

- [ ] **Step 1: Write the failing store tests**

Create `src/store/threads.defaultModel.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the DB layer so the store actions don't hit tauri-plugin-sql. Only the
// functions our tested code paths call need real behavior; the rest are unused
// here (the store imports them but these tests don't exercise those paths).
vi.mock("@/lib/db", () => ({
  listThreads: vi.fn(async () => []),
  getSetting: vi.fn(async (key: string) =>
    key === "default_provider"
      ? "openai"
      : key === "default_model"
        ? "gpt-4o"
        : null,
  ),
  setSetting: vi.fn(async () => {}),
  SYSTEM_PROMPT_ADDENDUM_KEY: "system_prompt_addendum",
}));

import { useThreads } from "@/store/threads";
import { setSetting } from "@/lib/db";
import { PROVIDERS } from "@/lib/providers";

beforeEach(() => {
  // Reset the singleton store to a clean draft state before each test.
  useThreads.setState({
    initialized: false,
    threads: [],
    currentThreadId: null,
    messages: [],
    defaultProvider: PROVIDERS[0].id,
    defaultModel: PROVIDERS[0].defaultModel,
    draftProvider: PROVIDERS[0].id,
    draftModel: PROVIDERS[0].defaultModel,
  });
  vi.clearAllMocks();
});

describe("default model in threads store", () => {
  it("init() loads the saved default and seeds the draft from it", async () => {
    await useThreads.getState().init();
    const s = useThreads.getState();
    expect(s.defaultProvider).toBe("openai");
    expect(s.defaultModel).toBe("gpt-4o");
    expect(s.draftProvider).toBe("openai");
    expect(s.draftModel).toBe("gpt-4o");
  });

  it("startNewChat() resets the draft to the cached default", () => {
    useThreads.setState({
      defaultProvider: "openai",
      defaultModel: "gpt-4o",
      draftProvider: "gemini",
      draftModel: "gemini-2.0-flash",
    });
    useThreads.getState().startNewChat();
    const s = useThreads.getState();
    expect(s.draftProvider).toBe("openai");
    expect(s.draftModel).toBe("gpt-4o");
  });

  it("setDefaultModel() persists both keys and updates state + draft", async () => {
    await useThreads.getState().setDefaultModel("mistral", "mistral-large-latest");
    expect(setSetting).toHaveBeenCalledWith("default_provider", "mistral");
    expect(setSetting).toHaveBeenCalledWith("default_model", "mistral-large-latest");
    const s = useThreads.getState();
    expect(s.defaultProvider).toBe("mistral");
    expect(s.defaultModel).toBe("mistral-large-latest");
    // currentThreadId is null (a draft), so the live draft updates too.
    expect(s.draftProvider).toBe("mistral");
    expect(s.draftModel).toBe("mistral-large-latest");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/store/threads.defaultModel.test.ts`
Expected: FAIL — `setDefaultModel` is not a function, and `defaultProvider` is undefined.

- [ ] **Step 3: Add the settings-key constants**

In `src/store/threads.ts`, after line 29 (`const LAST_THREAD_KEY = "last_thread_id";`) add:

```ts
const DEFAULT_PROVIDER_KEY = "default_provider";
const DEFAULT_MODEL_KEY = "default_model";
```

- [ ] **Step 4: Extend the `ThreadsState` interface**

In `src/store/threads.ts`, in the `ThreadsState` interface, immediately after the `draftModel: string;` line (~line 48) add:

```ts
  /** Provider/model new interactions start from (persisted default). */
  defaultProvider: Provider;
  defaultModel: string;
```

And in the actions section of the interface (next to `setProviderModel`), add:

```ts
  /** Persist the default provider+model for new interactions. */
  setDefaultModel: (provider: Provider, model: string) => Promise<void>;
```

- [ ] **Step 5: Add the initial state**

In `src/store/threads.ts`, after the `draftModel: PROVIDERS[0].defaultModel,` line (~line 139) add:

```ts
  defaultProvider: PROVIDERS[0].id,
  defaultModel: PROVIDERS[0].defaultModel,
```

- [ ] **Step 6: Seed the default in `init()`**

In `src/store/threads.ts`, replace the `init` action body. The current body is:

```ts
  init: async () => {
    if (get().initialized) return;
    const threads = await listThreads();
    set({ threads, initialized: true });
    const lastId = await getSetting(LAST_THREAD_KEY);
    if (lastId && threads.some((t) => t.id === lastId)) {
      await get().selectThread(lastId);
    } else if (threads.length > 0) {
      await get().selectThread(threads[0].id);
    } else {
      get().startNewChat();
    }
  },
```

Replace it with (adds the default load + draft seed before the thread-selection branch):

```ts
  init: async () => {
    if (get().initialized) return;
    const threads = await listThreads();
    set({ threads, initialized: true });
    // Load the persisted default and seed the draft from it before deciding
    // which thread to open, so a fresh-draft launch starts on the default.
    const [dp, dm] = await Promise.all([
      getSetting(DEFAULT_PROVIDER_KEY),
      getSetting(DEFAULT_MODEL_KEY),
    ]);
    const def = resolveDefault(dp, dm);
    set({
      defaultProvider: def.provider,
      defaultModel: def.model,
      draftProvider: def.provider,
      draftModel: def.model,
    });
    const lastId = await getSetting(LAST_THREAD_KEY);
    if (lastId && threads.some((t) => t.id === lastId)) {
      await get().selectThread(lastId);
    } else if (threads.length > 0) {
      await get().selectThread(threads[0].id);
    } else {
      get().startNewChat();
    }
  },
```

- [ ] **Step 7: Reset the draft to the default in `startNewChat` and `startNewChatInProject`**

In `src/store/threads.ts`, replace `startNewChat`:

```ts
  startNewChat: () => {
    set({
      currentThreadId: null,
      messages: [],
      error: null,
      draftProjectId: null,
      draftProvider: get().defaultProvider,
      draftModel: get().defaultModel,
    });
  },
```

And replace `startNewChatInProject`:

```ts
  startNewChatInProject: (projectId) => {
    set({
      currentThreadId: null,
      messages: [],
      error: null,
      draftProjectId: projectId,
      draftProvider: get().defaultProvider,
      draftModel: get().defaultModel,
    });
  },
```

- [ ] **Step 8: Add the `setDefaultModel` action**

In `src/store/threads.ts`, add this action next to `setProviderModel` (inside the store object):

```ts
  setDefaultModel: async (provider, model) => {
    await setSetting(DEFAULT_PROVIDER_KEY, provider);
    await setSetting(DEFAULT_MODEL_KEY, model);
    // When the user is on an unsaved draft, reflect the change in the live
    // draft immediately (so the model picker updates); otherwise just cache it.
    const onDraft = get().currentThreadId === null;
    set({
      defaultProvider: provider,
      defaultModel: model,
      ...(onDraft ? { draftProvider: provider, draftModel: model } : {}),
    });
  },
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run src/store/threads.defaultModel.test.ts src/store/threads.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/store/threads.ts src/store/threads.defaultModel.test.ts
git commit -m "Persist and seed a default provider/model for new interactions"
```

---

### Task 3: `DefaultModel` settings card

A settings card mirroring `ModelPicker`'s provider `<select>` + free-text model input, bound to the store's default.

**Files:**
- Create: `src/components/settings/DefaultModel.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/settings/DefaultModel.tsx`:

```tsx
import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useThreads } from "@/store/threads";
import { useProviders } from "@/lib/providers";
import type { Provider } from "@/types/db";

/**
 * Default-model settings (T?): the provider+model new chats and the quick-input
 * overlay start from. Mirrors ModelPicker's UX (provider dropdown + free-text
 * model; switching provider prefills its defaultModel) but writes the persisted
 * default via `setDefaultModel` instead of the current thread/draft.
 */
export function DefaultModel() {
  const provider = useThreads((s) => s.defaultProvider);
  const model = useThreads((s) => s.defaultModel);
  const setDefaultModel = useThreads((s) => s.setDefaultModel);
  const providers = useProviders();

  const providerEnabled = providers.some((p) => p.id === provider);
  const allDisabled = providers.length === 0;

  // Local model draft so typing doesn't persist on every keystroke; re-sync at
  // render (not via effect) when the stored model changes.
  const [modelDraft, setModelDraft] = useState(model);
  const [syncedModel, setSyncedModel] = useState(model);
  if (model !== syncedModel) {
    setSyncedModel(model);
    setModelDraft(model);
  }

  function onProviderChange(p: Provider) {
    const meta = providers.find((x) => x.id === p);
    if (!meta) return; // ignore the inert disabled-provider option
    void setDefaultModel(p, meta.defaultModel);
  }

  function commitModel() {
    const m = modelDraft.trim();
    if (m && m !== model) void setDefaultModel(provider, m);
    else setModelDraft(model);
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>Default Model</CardTitle>
        <CardDescription>
          The provider and model new chats (and the quick-input overlay) start
          with. You can still change the model per chat from the top bar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {allDisabled ? (
          <p className="text-muted-foreground text-sm">
            No providers enabled — enable one in Settings → Plugins.
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <select
              value={provider}
              onChange={(e) => onProviderChange(e.target.value as Provider)}
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            >
              {!providerEnabled && (
                <option value={provider} disabled>
                  {provider} (disabled)
                </option>
              )}
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <Input
              value={modelDraft}
              onChange={(e) => setModelDraft(e.target.value)}
              onBlur={commitModel}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitModel();
                }
              }}
              className="h-9 w-56 text-sm"
              aria-label="Default model"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run build`
Expected: build succeeds (tsc + vite), no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/DefaultModel.tsx
git commit -m "Add Default Model settings card"
```

---

### Task 4: Wire `DefaultModel` into the Settings nav + final verification

**Files:**
- Modify: `src/components/settings/SettingsView.tsx` (import + `SECTIONS`)

- [ ] **Step 1: Add the import**

In `src/components/settings/SettingsView.tsx`, after the `ApiKeys` import (line 2) add:

```tsx
import { DefaultModel } from "@/components/settings/DefaultModel";
```

- [ ] **Step 2: Add the nav section**

In `src/components/settings/SettingsView.tsx`, insert into the `SECTIONS` array immediately after the `api-keys` entry:

```ts
  { id: "default-model", label: "Default Model", Component: DefaultModel },
```

The start of `SECTIONS` should now read:

```ts
const SECTIONS: Section[] = [
  { id: "api-keys", label: "API Keys", Component: ApiKeys },
  { id: "default-model", label: "Default Model", Component: DefaultModel },
  { id: "memory", label: "Memory", Component: Memory },
```

- [ ] **Step 3: Run the full verification suite**

Run: `npx vitest run && npm run build && npm run lint`
Expected: all tests pass; build succeeds; lint clean (no output errors).

- [ ] **Step 4: Manual verification (in `npm run tauri dev`)**

- Open Settings → **Default Model**. Change the provider to OpenAI; the model field prefills `gpt-4o`. Edit the model text and press Enter.
- Start a **New chat** → the top-bar model picker shows the new default.
- Trigger the **quick-input overlay** (Alt+Space), submit a prompt → the created thread uses the default provider/model.
- **Restart** the app (`npm run tauri dev`) → new chats still start on the saved default (not Anthropic).

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/SettingsView.tsx
git commit -m "Wire Default Model into the settings nav"
```

---

## Self-Review

**Spec coverage:**
- Persistence (`default_provider` / `default_model`, fallback `PROVIDERS[0]`) → Task 1 (`resolveDefault`) + Task 2 (constants, `init` load, `setDefaultModel` write). ✓
- Store state + `init` seeding + `startNewChat`/`startNewChatInProject` reset + `setDefaultModel` (with draft update when on a draft) → Task 2. ✓
- `DefaultModel.tsx` mirroring ModelPicker, all-disabled + inert-disabled-option handling → Task 3. ✓
- `SettingsView` nav entry placed second → Task 4. ✓
- Tests (startNewChat seeds from default; setDefaultModel persists + updates) → Task 2; fallback logic → Task 1. ✓
- Edge cases: unset → `PROVIDERS[0]` (Task 1 tests); disabled default provider → inert option in Task 3. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `resolveDefault(provider, model)` and `DefaultModel` interface (Task 1) are used consistently in `init` (Task 2). `setDefaultModel(provider: Provider, model: string)` signature matches the interface, the action, the test calls, and the component's `void setDefaultModel(...)` calls. `defaultProvider` / `defaultModel` names are identical across interface, initial state, `init`, `startNewChat`, `setDefaultModel`, tests, and component. ✓

**Note on commits:** Steps commit to the current branch. If executing on `main`, create a feature branch first (the execution skill / worktree handles this). Commit messages omit Co-Authored-By per the repo owner's preference.
