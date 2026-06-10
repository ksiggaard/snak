# Configurable default model

## Problem

New interactions always start on Anthropic / `claude-opus-4-8`. The draft
provider/model are seeded from `PROVIDERS[0]` at module init and, while the
draft is "sticky" within a session, every app restart reverts to Anthropic.
There is no way for a user who prefers, say, OpenAI `gpt-4o` to have new chats
start there. The per-thread model is already persisted per thread; what is
missing is a persisted **default** for *new* interactions.

## Goal

Let the user pick a default provider + model that seeds every new interaction —
new chats and the quick-input overlay — configured from a Settings section and
persisted across restarts. The per-chat model picker still overrides for an
individual thread/draft.

Out of scope: per-provider default models, a curated model dropdown (model stays
free-text as it is today), automatic fallback when the default provider is
later disabled.

## Persistence

Two new `settings`-table keys, following the existing `last_thread_id` /
`global_shortcut` pattern (read via `getSetting`, written via `setSetting`):

- `default_provider` — a `Provider` id.
- `default_model` — the model string.

When either is absent, fall back to `PROVIDERS[0]` (`anthropic` /
`claude-opus-4-8`). This is today's implicit default, now explicit and editable.

## Store changes (`src/store/threads.ts`)

New state:

- `defaultProvider: Provider` — initialized to `PROVIDERS[0].id`.
- `defaultModel: string` — initialized to `PROVIDERS[0].defaultModel`.

Behavior:

- `init()` — after loading threads, read `default_provider` / `default_model`
  from settings (fallback to `PROVIDERS[0]`), set `defaultProvider` /
  `defaultModel`, and seed `draftProvider` / `draftModel` from them. This runs
  before the existing select-last-thread / start-new-chat branch.
- `startNewChat()` and `startNewChatInProject()` — set `draftProvider` /
  `draftModel` to the cached default. This makes every new chat (and, via the
  `quick-submit` listener that calls `startNewChat()` + `send()`, the
  quick-input overlay) begin from the default.
- New action `setDefaultModel(provider: Provider, model: string)`:
  - `await setSetting("default_provider", provider)` and
    `setSetting("default_model", model)`.
  - `set({ defaultProvider: provider, defaultModel: model })`.
  - If `currentThreadId === null` (the user is on an unsaved draft), also set
    `draftProvider` / `draftModel` so the change is immediately visible in the
    model picker.

`send()` is unchanged: it already persists a new thread with
`draftProvider` / `draftModel`, which now reflect the default.

## UI

New component `src/components/settings/DefaultModel.tsx`, modeled on
`ModelPicker`:

- Reads `useProviders()` for the active (enabled) provider list and the
  store's `defaultProvider` / `defaultModel`.
- A provider `<select>` + a free-text model `Input`. Switching the provider
  prefills that provider's `defaultModel`; the model field is editable text.
  Committing (blur / Enter) calls `setDefaultModel(provider, model)`.
- Wrapped in the standard settings `Card` (title "Default Model", a short
  description) so it sits naturally in the settings layout.
- All-providers-disabled state: show the same "No providers enabled — enable one
  in Settings → Plugins" message as `ModelPicker`.
- If the saved default provider is not in the active list, render it as an inert
  `(disabled)` option exactly as `ModelPicker` does, so the value still shows.

Add a section to `src/components/settings/SettingsView.tsx`:

- `{ id: "default-model", label: "Default Model", Component: DefaultModel }`,
  placed second in `SECTIONS` (after "API Keys").

## Testing

Unit tests in `src/store/threads.test.ts` (following its existing db-mock
setup):

- After `init()` with stored `default_provider` / `default_model`, a subsequent
  `startNewChat()` leaves `draftProvider` / `draftModel` equal to the stored
  default.
- `setDefaultModel(p, m)` writes both settings keys (assert the `setSetting`
  mock calls) and updates `defaultProvider` / `defaultModel`.
- `startNewChat()` resets a changed draft back to the default.

## Edge cases

- **Unset default** → `PROVIDERS[0]` (Anthropic / `claude-opus-4-8`).
- **Default provider later disabled** → the picker shows it as an inert
  `(disabled)` option and send-gating handles it (existing behavior). No
  automatic fallback — the user picks another provider. (YAGNI.)
