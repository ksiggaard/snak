> 📐 **Historical design doc.** A dated, point-in-time design record — kept for the
> rationale, not as current truth. For how the feature works today,
> [`AGENTS.md`](../../../AGENTS.md) is canonical; where this doc and the code disagree,
> the code wins.

# Configurable Model List + Single Chat Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the chat's provider-dropdown + free-text model field with a single combined "Provider – Model" dropdown driven by a user-configurable per-provider model list, filtered to providers that have an API key.

**Architecture:** A new `models` SQLite table (seeded with defaults) holds `{provider, model_id, label}` rows, edited from a new Settings "Models" card via a `useModels` store. A pure `buildModelOptions` helper flattens the list into combined options, filtered by enabled+keyed providers; `ModelPicker` renders them as one `<select>`. The "Default Model" card reuses the same helper, key-agnostic.

**Tech Stack:** Tauri v2 + `tauri-plugin-sql` (Rust migrations), React 19, TypeScript, Zustand, Tailwind v4 + shadcn/ui, Vitest. Frontend commands from repo root; `cargo` from `src-tauri/` (PATH: `~/.cargo/bin`).

---

### Task 1: `models` table migration (seeded)

**Files:**
- Create: `src-tauri/migrations/006_models.sql`
- Modify: `src-tauri/src/lib.rs` (`migrations()` vec, after the version-5 entry ~line 91)

- [ ] **Step 1: Create the migration SQL**

Create `src-tauri/migrations/006_models.sql`:

```sql
-- Configurable per-provider model list. Each row is one selectable model:
-- `model_id` is sent to the provider API; `label` is the friendly display name
-- shown in the combined "Provider - Label" dropdown. User-editable in Settings.
CREATE TABLE IF NOT EXISTS models (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    provider   TEXT NOT NULL,
    model_id   TEXT NOT NULL,
    label      TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (provider, model_id)
);

-- Seed sensible defaults (runs once by migration version; user edits/deletes
-- are never re-seeded). Model ids follow the claude-api guidance.
INSERT INTO models (provider, model_id, label, sort_order) VALUES
    ('anthropic', 'claude-opus-4-8',       'Opus 4.8',         0),
    ('anthropic', 'claude-sonnet-4-6',     'Sonnet 4.6',       1),
    ('anthropic', 'claude-haiku-4-5',      'Haiku 4.5',        2),
    ('openai',    'gpt-4o',                'GPT-4o',           0),
    ('mistral',   'mistral-large-latest',  'Mistral Large',    0),
    ('gemini',    'gemini-2.0-flash',      'Gemini 2.0 Flash', 0);
```

- [ ] **Step 2: Register the migration in `lib.rs`**

In `src-tauri/src/lib.rs`, inside `migrations()`, add a new entry immediately after the version-5 `Migration { ... }` block (the `user_memory` one ends ~line 91), before the closing `]`:

```rust
        Migration {
            version: 6,
            description: "models: configurable per-provider model list (seeded)",
            sql: include_str!("../migrations/006_models.sql"),
            kind: MigrationKind::Up,
        },
```

- [ ] **Step 3: Verify the backend compiles (migration embeds via include_str!)**

Run: `export PATH="$HOME/.cargo/bin:$PATH" && cargo build --manifest-path src-tauri/Cargo.toml`
Expected: `Finished` with no errors (a missing/misnamed SQL file would fail `include_str!`).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/migrations/006_models.sql src-tauri/src/lib.rs
git commit -m "Add seeded models table (migration 006)"
```

---

### Task 2: `Model` type + db helpers

**Files:**
- Modify: `src/types/db.ts` (add `Model` interface after `ProjectFile`)
- Modify: `src/lib/db.ts` (import `Model`; add a Models section)

- [ ] **Step 1: Add the `Model` type**

In `src/types/db.ts`, add after the `ProjectFile` interface:

```ts
export interface Model {
  id: number;
  provider: Provider;
  model_id: string;
  /** Friendly display label, e.g. "Opus 4.8". */
  label: string;
  sort_order: number;
}
```

- [ ] **Step 2: Import `Model` in db.ts**

In `src/lib/db.ts`, add `Model,` to the type import block from `@/types/db` (keep the list alphabetical — between `Message` and `Project`):

```ts
import type {
  Attachment,
  AttachmentKind,
  Message,
  Model,
  Project,
  ProjectFile,
  Provider,
  Role,
  SearchHit,
  Thread,
  Usage,
  UserMemory,
} from "@/types/db";
```

- [ ] **Step 3: Add the Models db helpers**

In `src/lib/db.ts`, append at the end of the file:

```ts
// ---------------------------------------------------------------------------
// Models (configurable per-provider model list)
// ---------------------------------------------------------------------------

/** All configured models, ordered by provider then sort_order. */
export async function listModels(): Promise<Model[]> {
  const db = await getDb();
  return db.select<Model[]>(
    `SELECT id, provider, model_id, label, sort_order
       FROM models
      ORDER BY provider, sort_order, label`,
  );
}

/** Add a model for a provider (appended after that provider's current rows). */
export async function addModel(input: {
  provider: Provider;
  model_id: string;
  label: string;
}): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ next: number }[]>(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
       FROM models WHERE provider = $1`,
    [input.provider],
  );
  const sortOrder = rows[0]?.next ?? 0;
  await db.execute(
    `INSERT INTO models (provider, model_id, label, sort_order)
     VALUES ($1, $2, $3, $4)`,
    [input.provider, input.model_id, input.label, sortOrder],
  );
}

/** Delete a model by id. */
export async function deleteModel(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM models WHERE id = $1`, [id]);
}
```

- [ ] **Step 4: Verify it typechecks**

Run: `npm run build`
Expected: build succeeds (tsc + vite), no errors.

- [ ] **Step 5: Commit**

```bash
git add src/types/db.ts src/lib/db.ts
git commit -m "Add Model type and models db helpers"
```

---

### Task 3: `buildModelOptions` pure helper (TDD)

**Files:**
- Create: `src/lib/modelOptions.ts`
- Test: `src/lib/modelOptions.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/modelOptions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildModelOptions } from "@/lib/modelOptions";
import type { ProviderMeta } from "@/lib/providers";
import type { Model, Provider } from "@/types/db";

const provider = (id: Provider, label: string): ProviderMeta => ({
  id,
  label,
  defaultModel: "x",
  keyHint: "",
});

const model = (
  id: number,
  provider: Provider,
  model_id: string,
  label: string,
  sort_order = 0,
): Model => ({ id, provider, model_id, label, sort_order });

const providers = [provider("anthropic", "Anthropic"), provider("openai", "OpenAI")];
const models = [
  model(1, "anthropic", "claude-opus-4-8", "Opus 4.8", 0),
  model(2, "anthropic", "claude-sonnet-4-6", "Sonnet 4.6", 1),
  model(3, "openai", "gpt-4o", "GPT-4o", 0),
];

describe("buildModelOptions", () => {
  it("includes only keyed providers' models, formatted 'Provider - Label'", () => {
    const opts = buildModelOptions(providers, new Set(["anthropic"]), models, null);
    expect(opts.map((o) => o.display)).toEqual([
      "Anthropic - Opus 4.8",
      "Anthropic - Sonnet 4.6",
    ]);
    expect(opts.every((o) => o.active)).toBe(true);
  });

  it("excludes a keyed provider with no configured models", () => {
    const opts = buildModelOptions(providers, new Set(["openai"]), [models[0], models[1]], null);
    expect(opts).toEqual([]);
  });

  it("orders each provider's models by sort_order", () => {
    const reversed = [models[1], models[0]];
    const opts = buildModelOptions(providers, new Set(["anthropic"]), reversed, null);
    expect(opts.map((o) => o.modelId)).toEqual(["claude-opus-4-8", "claude-sonnet-4-6"]);
  });

  it("prepends the current combo as an inert option when absent", () => {
    const opts = buildModelOptions(
      providers,
      new Set(["anthropic"]),
      models,
      { provider: "anthropic", model: "claude-opus-4-1" },
    );
    expect(opts[0]).toMatchObject({
      provider: "anthropic",
      modelId: "claude-opus-4-1",
      display: "Anthropic - claude-opus-4-1",
      active: false,
    });
    expect(opts).toHaveLength(3);
  });

  it("does not duplicate the current combo when it is already listed", () => {
    const opts = buildModelOptions(
      providers,
      new Set(["anthropic"]),
      models,
      { provider: "anthropic", model: "claude-opus-4-8" },
    );
    expect(opts).toHaveLength(2);
    expect(opts.every((o) => o.active)).toBe(true);
  });

  it("returns [] when nothing qualifies and there is no current combo", () => {
    expect(buildModelOptions(providers, new Set(), models, null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/modelOptions.test.ts`
Expected: FAIL — `buildModelOptions is not a function` / cannot find module.

- [ ] **Step 3: Implement the helper**

Create `src/lib/modelOptions.ts`:

```ts
// Pure builder for the combined chat model dropdown (T?). Flattens the
// configurable model list into "Provider - Label" options, filtered to the
// providers that are active (passed in via `keyedProviderIds`). Kept pure and
// unit-tested; the React layer supplies the inputs.

import type { ProviderMeta } from "@/lib/providers";
import type { Model, Provider } from "@/types/db";

export interface ModelOption {
  provider: Provider;
  providerLabel: string;
  /** Model id sent to the provider API. */
  modelId: string;
  /** Friendly model label. */
  label: string;
  /** `${providerLabel} - ${label}` for the dropdown. */
  display: string;
  /** false only for an injected current-combo entry not in the configured list. */
  active: boolean;
}

/**
 * Build the dropdown options. A provider contributes its models only if it is
 * in `providers` (enabled) AND its id is in `keyedProviderIds`. If `current`
 * (the thread's saved provider+model) isn't among the results, it is prepended
 * as an inert entry so the value still renders.
 */
export function buildModelOptions(
  providers: ProviderMeta[],
  keyedProviderIds: Set<Provider>,
  models: Model[],
  current: { provider: Provider; model: string } | null,
): ModelOption[] {
  const options: ModelOption[] = [];
  for (const p of providers) {
    if (!keyedProviderIds.has(p.id)) continue;
    const provModels = models
      .filter((m) => m.provider === p.id)
      .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
    for (const m of provModels) {
      options.push({
        provider: p.id,
        providerLabel: p.label,
        modelId: m.model_id,
        label: m.label,
        display: `${p.label} - ${m.label}`,
        active: true,
      });
    }
  }
  if (current) {
    const present = options.some(
      (o) => o.provider === current.provider && o.modelId === current.model,
    );
    if (!present) {
      const meta = providers.find((p) => p.id === current.provider);
      const providerLabel = meta ? meta.label : current.provider;
      options.unshift({
        provider: current.provider,
        providerLabel,
        modelId: current.model,
        label: current.model,
        display: `${providerLabel} - ${current.model}`,
        active: false,
      });
    }
  }
  return options;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/modelOptions.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/modelOptions.ts src/lib/modelOptions.test.ts
git commit -m "Add pure buildModelOptions helper for the combined model dropdown"
```

---

### Task 4: `useModels` store + load on startup

**Files:**
- Create: `src/store/models.ts`
- Test: `src/store/models.test.ts`
- Modify: `src/App.tsx` (import + load in the mount effect)

- [ ] **Step 1: Write the failing store test**

Create `src/store/models.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  listModels: vi.fn(async () => [
    { id: 1, provider: "anthropic", model_id: "claude-opus-4-8", label: "Opus 4.8", sort_order: 0 },
  ]),
  addModel: vi.fn(async () => {}),
  deleteModel: vi.fn(async () => {}),
}));

import { useModels } from "@/store/models";
import { addModel, deleteModel } from "@/lib/db";

beforeEach(() => {
  useModels.setState({ models: [], loaded: false, error: null });
  vi.clearAllMocks();
});

describe("useModels", () => {
  it("load() populates models from the db", async () => {
    await useModels.getState().load();
    const s = useModels.getState();
    expect(s.loaded).toBe(true);
    expect(s.models).toHaveLength(1);
    expect(s.models[0].model_id).toBe("claude-opus-4-8");
  });

  it("add() calls the db helper then reloads", async () => {
    await useModels.getState().add("openai", "gpt-4o", "GPT-4o");
    expect(addModel).toHaveBeenCalledWith({
      provider: "openai",
      model_id: "gpt-4o",
      label: "GPT-4o",
    });
    // reloaded via listModels mock
    expect(useModels.getState().models).toHaveLength(1);
  });

  it("remove() calls the db helper then reloads", async () => {
    await useModels.getState().remove(1);
    expect(deleteModel).toHaveBeenCalledWith(1);
    expect(useModels.getState().loaded).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/store/models.test.ts`
Expected: FAIL — cannot find module `@/store/models`.

- [ ] **Step 3: Implement the store**

Create `src/store/models.ts`:

```ts
import { create } from "zustand";
import { addModel, deleteModel, listModels } from "@/lib/db";
import type { Model, Provider } from "@/types/db";

interface ModelsState {
  models: Model[];
  loaded: boolean;
  error: string | null;

  /** Load (or reload) the configured models from the db. */
  load: () => Promise<void>;
  /** Add a model for a provider, then reload. */
  add: (provider: Provider, modelId: string, label: string) => Promise<void>;
  /** Delete a model by id, then reload. */
  remove: (id: number) => Promise<void>;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useModels = create<ModelsState>((set, get) => ({
  models: [],
  loaded: false,
  error: null,

  load: async () => {
    try {
      const models = await listModels();
      set({ models, loaded: true, error: null });
    } catch (e) {
      set({ error: errMsg(e), loaded: true });
    }
  },

  add: async (provider, modelId, label) => {
    try {
      await addModel({ provider, model_id: modelId, label });
      await get().load();
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  remove: async (id) => {
    try {
      await deleteModel(id);
      await get().load();
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },
}));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/store/models.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Load models on app startup**

In `src/App.tsx`, add the import after the `usePlugins` import:

```tsx
import { useModels } from "@/store/models";
```

Inside `App()`, add a selector near the other store selectors (after `const loadPlugins = usePlugins((s) => s.load);`):

```tsx
  const loadModels = useModels((s) => s.load);
```

In the mount `useEffect` that calls `init`/`initProjects`/`loadPlugins`/`loadInstalledThemes`, add `void loadModels();` and add `loadModels` to the dependency array:

```tsx
  useEffect(() => {
    void init();
    void initProjects();
    void loadPlugins();
    void loadInstalledThemes();
    void loadModels();
  }, [init, initProjects, loadPlugins, loadInstalledThemes, loadModels]);
```

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/store/models.ts src/store/models.test.ts src/App.tsx
git commit -m "Add useModels store and load models on startup"
```

---

### Task 5: Rewrite `ModelPicker` as a single combined dropdown

**Files:**
- Modify: `src/components/chat/ModelPicker.tsx` (full rewrite)

- [ ] **Step 1: Replace the component**

Replace the entire contents of `src/components/chat/ModelPicker.tsx` with:

```tsx
import { useEffect, useState } from "react";
import { useThreads } from "@/store/threads";
import { useModels } from "@/store/models";
import { useProviders } from "@/lib/providers";
import { buildModelOptions } from "@/lib/modelOptions";
import { hasApiKey } from "@/lib/keys";
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

  // Which enabled providers have a stored API key. Resolved async (like
  // ApiKeys.tsx); recomputed when the provider list changes. Leaving Settings
  // remounts ChatView, so a newly-added key is reflected on return to chat.
  const [keyed, setKeyed] = useState<Set<Provider>>(new Set());
  const providerKey = providers.map((p) => p.id).join(",");
  useEffect(() => {
    let active = true;
    void Promise.all(
      providers.map((p) => hasApiKey(p.id).then((ok) => [p.id, ok] as const)),
    ).then((pairs) => {
      if (active) setKeyed(new Set(pairs.filter(([, ok]) => ok).map(([id]) => id)));
    });
    return () => {
      active = false;
    };
    // providerKey captures the provider-list identity (primitive, stable).
  }, [providerKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = buildModelOptions(providers, keyed, models, { provider, model });
  const selectedIndex = options.findIndex(
    (o) => o.provider === provider && o.modelId === model,
  );

  if (options.length === 0) {
    return (
      <span className="text-muted-foreground text-sm">
        No models available — add an API key and models in Settings.
      </span>
    );
  }

  return (
    <select
      value={selectedIndex >= 0 ? selectedIndex : 0}
      onChange={(e) => {
        const opt = options[Number(e.target.value)];
        if (opt) void setProviderModel(opt.provider, opt.modelId);
      }}
      className="border-input bg-background h-9 max-w-72 rounded-md border px-2 text-sm"
      aria-label="Model"
    >
      {options.map((o, i) => (
        <option key={`${o.provider}:${o.modelId}`} value={i}>
          {o.display}
          {o.active ? "" : " (unavailable)"}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Verify build + lint + existing tests**

Run: `npm run build && npm run lint && npx vitest run`
Expected: build succeeds, lint clean, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/ModelPicker.tsx
git commit -m "Rewrite ModelPicker as a single combined provider+model dropdown"
```

---

### Task 6: "Models" settings card

**Files:**
- Create: `src/components/settings/Models.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/settings/Models.tsx`:

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useModels } from "@/store/models";
import { useProviders } from "@/lib/providers";
import type { Provider } from "@/types/db";

/**
 * Models settings card: per enabled provider, list its configured models and
 * allow add/remove. The combined chat dropdown and the Default Model picker
 * read this list (via `useModels`).
 */
export function Models() {
  const providers = useProviders();
  const models = useModels((s) => s.models);
  const add = useModels((s) => s.add);
  const remove = useModels((s) => s.remove);

  // Per-provider draft inputs for the add row, keyed by provider id.
  const [labelDraft, setLabelDraft] = useState<Record<string, string>>({});
  const [idDraft, setIdDraft] = useState<Record<string, string>>({});

  function submit(provider: Provider) {
    const label = (labelDraft[provider] ?? "").trim();
    const modelId = (idDraft[provider] ?? "").trim();
    if (!label || !modelId) return;
    void add(provider, modelId, label);
    setLabelDraft((d) => ({ ...d, [provider]: "" }));
    setIdDraft((d) => ({ ...d, [provider]: "" }));
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>Models</CardTitle>
        <CardDescription>
          The models offered per provider in the chat picker. Each has a model
          id (sent to the API) and a friendly label.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {providers.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No providers enabled — enable one in Settings → Plugins.
          </p>
        )}
        {providers.map((p) => {
          const rows = models.filter((m) => m.provider === p.id);
          return (
            <div key={p.id} className="flex flex-col gap-2">
              <div className="text-sm font-medium">{p.label}</div>
              {rows.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  No models yet — add one below.
                </p>
              )}
              {rows.map((m) => (
                <div key={m.id} className="flex items-center gap-2">
                  <span className="flex-1 text-sm">{m.label}</span>
                  <span className="text-muted-foreground font-mono text-xs">
                    {m.model_id}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void remove(m.id)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Input
                  value={labelDraft[p.id] ?? ""}
                  onChange={(e) =>
                    setLabelDraft((d) => ({ ...d, [p.id]: e.target.value }))
                  }
                  placeholder="Label (e.g. Opus 4.8)"
                  className="h-8 text-sm"
                />
                <Input
                  value={idDraft[p.id] ?? ""}
                  onChange={(e) =>
                    setIdDraft((d) => ({ ...d, [p.id]: e.target.value }))
                  }
                  placeholder="model id"
                  className="h-8 font-mono text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submit(p.id);
                    }
                  }}
                />
                <Button size="sm" onClick={() => submit(p.id)}>
                  Add
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/Models.tsx
git commit -m "Add Models settings card (per-provider add/remove)"
```

---

### Task 7: Update Default Model card to a single dropdown

**Files:**
- Modify: `src/components/settings/DefaultModel.tsx` (replace the picker body)

- [ ] **Step 1: Replace the component**

Replace the entire contents of `src/components/settings/DefaultModel.tsx` with:

```tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useThreads } from "@/store/threads";
import { useModels } from "@/store/models";
import { useProviders } from "@/lib/providers";
import { buildModelOptions } from "@/lib/modelOptions";

/**
 * Default-model settings: the provider+model new chats (and the quick-input
 * overlay) start from. Picks from the configured model list (Settings →
 * Models). Key-agnostic — you may set a default before adding the key — so it
 * lists all configured models for enabled providers.
 */
export function DefaultModel() {
  const provider = useThreads((s) => s.defaultProvider);
  const model = useThreads((s) => s.defaultModel);
  const setDefaultModel = useThreads((s) => s.setDefaultModel);
  const models = useModels((s) => s.models);
  const providers = useProviders();

  // All enabled providers count as selectable here (not filtered by API key).
  const allEnabled = new Set(providers.map((p) => p.id));
  const options = buildModelOptions(providers, allEnabled, models, {
    provider,
    model,
  });
  const selectedIndex = options.findIndex(
    (o) => o.provider === provider && o.modelId === model,
  );

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>Default Model</CardTitle>
        <CardDescription>
          The provider and model new chats (and the quick-input overlay) start
          with. You can still change it per chat from the top bar, and manage
          the list in Settings → Models.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {options.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No models configured — add some in Settings → Models.
          </p>
        ) : (
          <select
            value={selectedIndex >= 0 ? selectedIndex : 0}
            onChange={(e) => {
              const opt = options[Number(e.target.value)];
              if (opt) void setDefaultModel(opt.provider, opt.modelId);
            }}
            className="border-input bg-background h-9 max-w-72 rounded-md border px-2 text-sm"
            aria-label="Default model"
          >
            {options.map((o, i) => (
              <option key={`${o.provider}:${o.modelId}`} value={i}>
                {o.display}
              </option>
            ))}
          </select>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: build succeeds, lint clean (no unused imports — the old `useState`/`Input`/`Provider` imports are gone).

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/DefaultModel.tsx
git commit -m "Make Default Model a single dropdown over the configured list"
```

---

### Task 8: Add "Models" to the Settings nav + final verification

**Files:**
- Modify: `src/components/settings/SettingsView.tsx` (import + `SECTIONS`)

- [ ] **Step 1: Add the import**

In `src/components/settings/SettingsView.tsx`, add after the `DefaultModel` import:

```tsx
import { Models } from "@/components/settings/Models";
```

- [ ] **Step 2: Add the nav section**

In the `SECTIONS` array, insert a `models` entry immediately after the `default-model` entry. The start of `SECTIONS` should read:

```ts
const SECTIONS: Section[] = [
  { id: "api-keys", label: "API Keys", Component: ApiKeys },
  { id: "default-model", label: "Default Model", Component: DefaultModel },
  { id: "models", label: "Models", Component: Models },
  { id: "memory", label: "Memory", Component: Memory },
```

- [ ] **Step 3: Full verification suite**

Run: `npx vitest run && npm run build && npm run lint`
Expected: all tests pass; build succeeds; lint clean.

- [ ] **Step 4: Manual verification (in `npm run tauri dev`)**

- Settings → **Models**: each enabled provider shows seeded models; add a model (label + id) and it appears; remove one and it disappears.
- Chat top bar: the single dropdown lists `Provider - Label` entries **only for providers with an API key**; a provider with a key but no models doesn't appear; selecting an entry sets the thread's model.
- Settings → **Default Model**: single dropdown over all configured models (enabled providers); changing it makes new chats start there.
- Set the current chat to a model, then delete that model in Settings → it still shows in the picker as `(unavailable)` and the chat doesn't crash.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/SettingsView.tsx
git commit -m "Wire Models into the settings nav"
```

---

## Self-Review

**Spec coverage:**
- `models` table + seeds + migration registration → Task 1. ✓
- `Model` type + `listModels`/`addModel`/`deleteModel` → Task 2. ✓
- Pure `buildModelOptions` (enabled+keyed+has-models filter; `Provider - Label`; inject current; `[]` when none) → Task 3 + tests. ✓
- `useModels` store + startup load → Task 4 + test + App wiring. ✓
- Chat single dropdown, async key resolution, empty state, index-encoded value → Task 5. ✓
- Settings Models add/remove grouped by enabled provider → Task 6. ✓
- Default Model as dropdown, key-agnostic via all-enabled set → Task 7. ✓
- SettingsView nav entry (after Default Model) → Task 8. ✓
- Edge cases: current combo not in list (inert option, Task 3 test + Task 5/8 manual); default deleted → `resolveDefault` fallback (unchanged); no models/keys → empty-state messages (Tasks 5, 7). ✓

**Placeholder scan:** No TBD/TODO; every code step is complete.

**Type consistency:** `Model` (`{id:number, provider, model_id, label, sort_order}`) is identical across `types/db.ts`, db helpers, `buildModelOptions`, the store, and components. `buildModelOptions(providers, keyedProviderIds: Set<Provider>, models, current)` signature matches both call sites (ModelPicker passes the keyed set; DefaultModel passes the all-enabled set). `useModels` actions `load`/`add(provider, modelId, label)`/`remove(id)` match the store, its test, and the components. `addModel({provider, model_id, label})` arg shape matches db helper and store test assertion. `setProviderModel`/`setDefaultModel` reused unchanged from prior work.
