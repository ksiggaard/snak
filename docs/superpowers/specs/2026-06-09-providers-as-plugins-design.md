> 📐 **Historical design doc.** A dated, point-in-time design record — kept for the
> rationale, not as current truth. For how the feature works today,
> [`AGENTS.md`](../../../AGENTS.md) is canonical; where this doc and the code disagree,
> the code wins.

> ⚠️ **Superseded — see [ADR-0010](../../adr/0010-cloud-providers-are-user-added-custom-providers.md).**
> This design was *not* shipped. Cloud providers are **user-added custom providers**
> (settings rows seeded from presets), **not** plugins; only local Ollama is a built-in
> provider. Read this only for the history of the abandoned approach.

# T18 — Providers as built-in plugins (design)

## Goal

Make the four LLM providers (Anthropic, OpenAI, Mistral, Gemini) **built-in,
enabled-by-default plugins** of category `provider`, and have the provider
registry (`src/lib/providers.ts`) derive its active list from the **enabled**
provider plugins surfaced by the T12 host registry — falling back to the
hardcoded four so chat never regresses. Disabling a provider plugin removes its
models everywhere (ModelPicker, draft/thread selection, the API-keys list), and
the app handles the all-disabled state gracefully.

## Key constraint: zero chat regression

The Rust dispatch (`providers/mod.rs`) keeps matching `anthropic|openai|mistral|
gemini` exactly as today — that is the always-working fallback. **Disabling a
plugin is enforced purely on the frontend**: a disabled provider is not offered
or selectable, so the live streaming path is untouched. No Rust behavior changes.

## Architecture

The T12 foundation already ships everything backend-side:
- Four built-in provider descriptors in `src-tauri/src/plugins/builtin/*.json`,
  each `enabledByDefault: true`, with a `contributes` block matching
  `ProviderContribution` (`id,label,defaultModel,keyHint`).
- `list_plugins` / `set_plugin_enabled` commands; enabled-state persisted in
  app-data `plugins/enabled.json`.
- Frontend host registry: `buildRegistry` / `selectRegistry` / `usePlugins`.

So T18 is overwhelmingly a **frontend wiring** task:

1. **Registry derivation (`src/lib/providers.ts`).**
   - Keep `ProviderMeta` and rename the existing hardcoded const to
     `FALLBACK_PROVIDERS` (still exported as `PROVIDERS` for back-compat with the
     threads store, which I do not own and which reads `PROVIDERS[0]` at module
     init — it must stay a non-empty constant).
   - Add a pure `providersFromContributions(contribs): ProviderMeta[]` that maps
     enabled `ProviderContribution[]` → `ProviderMeta[]`, **filtering to ids the
     Rust dispatch actually knows** (`anthropic|openai|mistral|gemini`) so a
     malformed user manifest can't inject an undispatchable provider. If the
     result is empty, that is a legitimate all-disabled state — the *fallback to
     the four* only applies when the plugin layer yields nothing because it
     hasn't loaded yet (not loaded vs. loaded-and-all-disabled are distinct).
   - Expose a hook `useProviders()` returning the live list from
     `usePlugins`+`selectRegistry`, with the not-yet-loaded fallback.

2. **Consumers drive off the live list.**
   - `ModelPicker`: provider `<select>` lists `useProviders()`; defaultModel
     lookup uses it. Empty list → disabled select with "No providers enabled".
   - `ApiKeys`: iterate the live list (settings reflects enabled providers).
     Empty → guidance to enable a provider in the Plugins card.
   - `Composer` / `ChatView`: compose with T6 no-key gating. Add an
     all-disabled empty state: Send gated with "Enable a provider plugin in
     Settings → Plugins to start chatting." `providerLabel` falls back to the id.
   - A thread whose `provider`/`model` references a now-disabled provider must
     not crash: ModelPicker still shows the stored provider as a read-only
     fallback option (so the value renders), and the composer surfaces the
     disabled-provider message + re-enable path rather than throwing.

3. **Load timing.** `App` already loads plugins lazily via settings cards. To
   make providers correct on first paint, `App` calls `usePlugins().load()` in
   its mount effect (additive line) so the registry is populated app-wide.

## All-disabled behavior

- ModelPicker: select disabled, shows "No providers enabled".
- Composer: Send disabled; message points to Settings → Plugins.
- ApiKeys: shows guidance instead of an empty list.
- Existing thread on a disabled provider: renders without crashing; the picker
  keeps the stored provider visible as an inert option; composer shows the
  enable-provider guidance.
- Draft defaults in the store keep pointing at `PROVIDERS[0]` (the constant
  fallback) — harmless because the UI gates sending.

## Testing

- Unit: `providersFromContributions` derives/filters/dedupes from enabled
  contributions; empty contributions → empty; unknown ids dropped.
- Unit: all-disabled / fallback selection logic.

## Rust changes

None to provider dispatch (the fallback). Built-in descriptors already exist.
No `lib.rs` change required (plugin commands already registered in T12).

## Out of scope

User-installed provider plugins with novel dispatch (needs executable sandbox —
deferred per T12 security model). New manifests can only *describe* one of the
four known providers.
