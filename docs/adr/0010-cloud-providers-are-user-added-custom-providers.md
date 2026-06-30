# ADR-0010: Cloud providers are user-added custom providers, not plugins

* Status: accepted
* Deciders: snak core team
* Date: 2026-06-30

## Context and Problem Statement

snak is bring-your-own-key and OpenAI-compatible-first ([ADR-0002](./0002-provider-calls-in-rust-over-http.md)): most providers (OpenAI, Mistral, Groq, OpenRouter, DeepSeek, …) speak the same wire protocol and differ only by base URL, model id, and key. An earlier design (the T18 "providers as built-in plugins" spec, `docs/superpowers/specs/2026-06-09-providers-as-plugins-design.md`) proposed shipping each cloud provider as a built-in `provider`-category plugin whose enablement is read off the plugin registry. We had to decide whether a "provider" is a plugin or plain user configuration.

## Decision Drivers

* Zero-friction "add any OpenAI-compatible endpoint" without shipping or installing anything
* Don't ship secrets-adjacent defaults the user didn't ask for
* Avoid coupling the provider list to the plugin enablement system for no real gain
* Keep the data model simple — a provider is mostly a URL + protocol + default model

## Considered Options

* **Option 1:** Cloud providers are user-added **custom-provider rows** seeded from optional presets; only local Ollama is built-in
* **Option 2:** Each cloud provider is a built-in `provider`-category **plugin**, enabled/disabled via the plugin registry (the T18 direction)

## Decision Outcome

Chosen option: **Option 1 — user-added custom providers**, because a provider carries no behavior to extend (the wire protocols are already built-in, [ADR-0002](./0002-provider-calls-in-rust-over-http.md)) — it is pure configuration, so routing it through the plugin system added indirection without capability. **The app ships with no cloud providers.** A user adds one from the **Custom Providers** settings tab (`src/components/settings/CustomProviders.tsx`), optionally from a preset (`src/lib/providerPresets.ts`). Each is a `CustomProvider` row (`{id, label, protocol, baseUrl, defaultModel}`) in the `settings` table carrying a wire `protocol`; the active list is `local Ollama (the one built-in) + the user's custom providers`, composed by `useProviders()` / `activeProviders()` (`src/lib/providers.ts`). On upgrade, `migrateBuiltinProviders` (`src/lib/migrateProviders.ts`) recreates a custom provider for each formerly-built-in cloud provider that already has a stored key, reusing the canonical id so keys and threads keep resolving. This **supersedes the T18 providers-as-plugins design**, which is retained only as a historical record.

### Consequences

* **Positive:** Adding any OpenAI-compatible endpoint is a no-code, no-install settings action. The app ships clean (no provider the user didn't add). Providers stay decoupled from plugin enablement, and the model is a single, obvious data shape (a `settings` row). Keys ([ADR-0001](./0001-api-keys-in-os-keychain.md)) and threads keep resolving across the migration via canonical ids.
* **Negative:** Provider config lives in the `settings` table rather than the plugin registry, so it's a distinct subsystem from plugins (two places that "add capability" in the UI). Presets are a convenience list that must be kept reasonably current by hand. The T18 spec now contradicts the shipped model and needs its superseded banner so a reader doesn't follow it.

## Pros and Cons of the Options

### Option 1 — User-added custom providers

* **Good:** No-code add of any compatible endpoint; ships with nothing unwanted.
* **Good:** Simple data model; decoupled from plugin enablement; clean key/thread migration.
* **Bad:** A second "add capability" surface alongside plugins; presets are hand-maintained.

### Option 2 — Providers as built-in plugins (T18)

* **Good:** One unified extensibility surface (everything is a plugin).
* **Bad:** A provider has no behavior to extend — the protocols are already built-in — so the plugin layer is indirection without capability.
* **Bad:** Couples the provider list to plugin enablement and ships cloud-provider defaults the user never added.
