# Configurable model list + single chat model dropdown

## Problem

Model selection today is a provider `<select>` plus a **free-text** model field
(`ModelPicker`), and the just-added "Default Model" card mirrors that. Free text
is error-prone (typos → failed calls) and there's no curated set of models. The
chat also splits selection across two controls.

## Goal

- A **configurable per-provider model list**, edited from Settings, each entry a
  model id (sent to the API) plus a friendly display label.
- The chat uses a **single dropdown** of combined **provider + model** entries,
  shown only for **active** providers — for the current (all-cloud) providers,
  active means *enabled plugin* **and** *has a stored API key* **and** *has ≥1
  configured model*. Entries read e.g. `Anthropic - Opus 4.8`.
- The "Default Model" setting picks its value from the same list (no free text).

Out of scope (YAGNI): local/non-cloud providers (active = has key for now),
model reordering UI, per-model parameters.

## Data model & storage

New SQLite table via migration `src-tauri/migrations/006_models.sql` (a
user-edited list belongs in a table, like `projects`/`usage`, not the scalar
`settings` rows):

```sql
CREATE TABLE models (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  provider   TEXT NOT NULL,      -- provider id, e.g. "anthropic"
  model_id   TEXT NOT NULL,      -- string sent to the API, e.g. "claude-opus-4-8"
  label      TEXT NOT NULL,      -- display label, e.g. "Opus 4.8"
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(provider, model_id)
);
```

The migration **seeds defaults** (runs once by version, so edits/deletes never
get re-seeded):

- anthropic: `claude-opus-4-8` "Opus 4.8", `claude-sonnet-4-6` "Sonnet 4.6",
  `claude-haiku-4-5-20251001` "Haiku 4.5"
- openai: `gpt-4o` "GPT-4o"
- mistral: `mistral-large-latest` "Mistral Large"
- gemini: `gemini-2.0-flash` "Gemini 2.0 Flash"

Anthropic model ids follow the `claude-api` skill guidance (verify at
implementation time). Register the migration in `lib.rs` `migrations()` with the
next `version`; never edit a shipped migration.

## Frontend data access

- `src/types/db.ts`: `Model = { id: number; provider: Provider; model_id: string; label: string; sort_order: number }`.
- `src/lib/db.ts`: `listModels()`, `addModel({ provider, model_id, label })`,
  `deleteModel(id)` (typed wrappers over the one `getDb()` connection). Inserts
  use `sort_order` = current max for that provider + 1.
- `src/store/models.ts` (`useModels`): `{ models, loaded, error, load, add, remove }`,
  mirroring `useProjects`. `add`/`remove` call the db helper then reload.

## Pure option builder

`src/lib/modelOptions.ts` (pure, unit-tested):

```ts
export interface ModelOption {
  provider: Provider;
  providerLabel: string;
  modelId: string;
  label: string;       // friendly model label
  display: string;     // `${providerLabel} - ${label}`
  active: boolean;     // false only for an injected current-combo entry
}

/**
 * Flatten configured models into chat dropdown options. Includes a provider's
 * models only if it is in `providers` (enabled) AND its id is in
 * `keyedProviderIds` (has an API key). If `current` (the thread's saved combo)
 * is not among the resulting options, it is prepended as an inert entry
 * (active: false) so the value still renders.
 */
export function buildModelOptions(
  providers: ProviderMeta[],
  keyedProviderIds: Set<Provider>,
  models: Model[],
  current: { provider: Provider; model: string } | null,
): ModelOption[];
```

A provider with a key but **zero** configured models contributes nothing →
hidden. `display` for an injected current-combo entry uses the provider label if
known, else the raw provider id, and the raw model id as the label.

## Chat: single dropdown (`ModelPicker.tsx` rewrite)

- Reads `useProviders()` (enabled providers), `useModels().models`, and the
  current thread/draft `provider`+`model` (as today).
- Resolves API-key presence for the enabled providers with
  `Promise.all(providers.map(p => hasApiKey(p.id)))` into a `Set<Provider>`
  (`keyedProviderIds`), stored in local state; recomputed when the provider list
  changes (same pattern as `ApiKeys.tsx`). Leaving Settings remounts `ChatView`,
  so a newly-added key is reflected on return to chat.
- Renders one `<select>` whose options come from `buildModelOptions(...)`.
  Option `value` is the **array index** (avoids delimiter issues in ids); on
  change, look up the entry and call `setProviderModel(entry.provider, entry.modelId)`.
- Empty options (nothing active): render
  `"No models available — add an API key and models in Settings."`
- The injected current-combo entry (if any) is shown but selecting normal
  entries replaces it.

`setProviderModel`, the store, and the streaming path are unchanged.

## Settings: Models management (`src/components/settings/Models.tsx`)

- New card grouped by **enabled provider**. For each: its configured models as
  rows (`label` — `model_id`) each with a **Remove** button, plus an **Add** row
  (label input + model-id input + Add button). Writes via `useModels`.
- No reorder UI (v1); list sorted by `sort_order` then `label`.
- Added to `SettingsView` `SECTIONS` right after `api-keys`:
  `{ id: "models", label: "Models", Component: Models }`.

## Settings: Default Model becomes a dropdown (`DefaultModel.tsx` update)

- Replace the provider `<select>` + free-text `Input` with a single `<select>`
  over **all configured models for enabled providers** — **key-agnostic** (you
  may set a default before adding the key). Built from `useModels` + `useProviders`
  (reusing the per-provider grouping; not the key-filtered chat builder).
- On change, call the existing `setDefaultModel(provider, modelId)`. The store's
  `defaultProvider`/`defaultModel`, `init` seeding, and `startNewChat` reset are
  untouched. `resolveDefault` still falls back to `PROVIDERS[0]` if the stored
  default was since deleted.

## Edge cases

- **Thread on a now-invalid combo** (model removed / provider keyless) → inert
  leading option so the value renders; user can pick a valid one.
- **Default points at a deleted model** → `resolveDefault` fallback to
  `PROVIDERS[0]` (existing behavior).
- **No models / no keys** → chat empty-state message; send stays gated as today.

## Testing

- **Pure** `buildModelOptions` (Vitest): filters by enabled+keyed+has-models;
  formats `"Provider - Label"`; injects current combo when absent; returns `[]`
  when nothing qualifies; a keyed provider with no models is excluded.
- `useModels` store test with a mocked `@/lib/db` (add/remove updates state) —
  exercises the db helper wrappers.
- Existing `resolveDefault` tests remain valid.

## Components & boundaries (summary)

| Unit | Responsibility |
|------|----------------|
| `migrations/006_models.sql` | `models` table + seed defaults |
| `db.ts` model helpers + `Model` type | typed persistence access |
| `store/models.ts` (`useModels`) | in-memory model list + mutations |
| `lib/modelOptions.ts` | pure chat-option builder (tested) |
| `ModelPicker.tsx` | single combined chat dropdown |
| `settings/Models.tsx` | per-provider add/remove UI |
| `settings/DefaultModel.tsx` | default picked from the list |
