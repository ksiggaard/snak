// Provider registry (T18: sourced from enabled provider plugins).
//
// The four providers are now built-in, enabled-by-default plugins of category
// `provider` (descriptors in src-tauri/src/plugins/builtin/*.json). The *active*
// provider list is derived from the enabled provider contributions surfaced by
// the T12 host registry (`selectRegistry`). The hardcoded four remain as
// `FALLBACK_PROVIDERS` / `PROVIDERS` so:
//   1. the Rust dispatch (providers/mod.rs) always resolves these ids — disabling
//      is a frontend-only concern, so the live streaming path never regresses;
//   2. consumers reading before the plugin layer has loaded still get a sane,
//      non-empty list instead of a broken/empty registry.
//
// Disabling a provider plugin removes it from `useProviders()` everywhere
// (ModelPicker, ApiKeys, send-gating). The all-disabled state is handled by the
// consumers (see ModelPicker / Composer / ChatView).

import { useMemo } from "react";
import type { ProviderContribution } from "@/types/plugins";
import { buildRegistry } from "@/lib/plugins";
import { usePlugins } from "@/store/plugins";
import { useCustomProviders } from "@/store/customProviders";
import type { Provider } from "@/types/db";

export interface ProviderMeta {
  id: Provider;
  label: string;
  /** Default model used for new threads. */
  defaultModel: string;
  /** Placeholder hint shown in the key input. */
  keyHint: string;
}

/**
 * The provider ids the Rust dispatch (`providers::stream`) actually knows how to
 * stream. A `provider` plugin can only *describe* one of these — the host never
 * executes arbitrary provider code (T12 security model) — so we filter
 * contributions to this set, guarding against a malformed/unknown manifest
 * injecting an undispatchable provider into the UI.
 */
export const KNOWN_PROVIDER_IDS = [
  "anthropic",
  "openai",
  "mistral",
  "gemini",
  "ollama",
] as const;

function isKnownProvider(id: string): id is Provider {
  return (KNOWN_PROVIDER_IDS as readonly string[]).includes(id);
}

/**
 * The hardcoded four. Always non-empty; used as the fallback before the plugin
 * registry has loaded and as the source of truth for the Rust dispatch ids.
 * Re-exported as `PROVIDERS` for the threads store, which reads `PROVIDERS[0]`
 * at module init for its draft defaults and needs a stable, non-empty constant.
 */
export const FALLBACK_PROVIDERS: ProviderMeta[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    defaultModel: "claude-opus-4-8",
    keyHint: "sk-ant-…",
  },
  {
    id: "openai",
    label: "OpenAI",
    defaultModel: "gpt-4o",
    keyHint: "sk-…",
  },
  {
    id: "mistral",
    label: "Mistral",
    defaultModel: "mistral-large-latest",
    keyHint: "…",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    defaultModel: "gemini-2.0-flash",
    keyHint: "AIza…",
  },
  // Keyless local provider (T37). Appended LAST so PROVIDERS[0] (the draft
  // default) stays Anthropic. keyHint is "" — no key row is ever rendered.
  {
    id: "ollama",
    label: "Local (Ollama)",
    defaultModel: "llama3.2:1b",
    keyHint: "",
  },
];

/** Back-compat alias (the threads store reads `PROVIDERS[0]` at module init). */
export const PROVIDERS = FALLBACK_PROVIDERS;

/**
 * Providers that talk to a local daemon and need no API key (T37). These are
 * skipped by the keychain-presence machinery (`useKeys`) and the API-keys
 * settings card; the composer gates them on daemon reachability instead.
 */
export const KEYLESS_PROVIDER_IDS = ["ollama"] as const;

/** Whether a provider id is keyless (no API key stored or required). */
export function isKeylessProvider(id: string): boolean {
  return (KEYLESS_PROVIDER_IDS as readonly string[]).includes(id);
}

/**
 * Union the key-presence set with the enabled keyless providers, so consumers
 * gating on "has a key" (model picker) treat keyless providers as always
 * available. Pure — returns a new set; the inputs are not mutated.
 */
export function withKeylessProviders(
  present: Set<Provider>,
  providers: ProviderMeta[],
): Set<Provider> {
  const out = new Set(present);
  for (const p of providers) {
    // Keyless built-ins (Ollama) and user-added custom providers (any id not in
    // the built-in set) are available regardless of a stored key — a custom
    // provider's key is optional (a local server may need none).
    if (isKeylessProvider(p.id) || !isKnownProvider(p.id)) out.add(p.id);
  }
  return out;
}

/**
 * Map enabled `provider` plugin contributions to `ProviderMeta`. Pure (unit
 * tested). Filters to ids the Rust dispatch knows and de-dupes by id (a built-in
 * and a user manifest could both describe the same provider — first wins).
 */
export function providersFromContributions(
  contribs: ProviderContribution[],
): ProviderMeta[] {
  const out: ProviderMeta[] = [];
  const seen = new Set<string>();
  for (const c of contribs) {
    if (!isKnownProvider(c.id) || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({
      id: c.id,
      label: c.label,
      defaultModel: c.defaultModel,
      keyHint: c.keyHint,
    });
  }
  return out;
}

/**
 * Resolve the active provider list from the plugin layer.
 *
 * - Not yet loaded → `FALLBACK_PROVIDERS` (avoid a flash of "no providers" and
 *   keep the first paint working).
 * - Loaded, providers enabled → just those (the all-disabled set is a valid,
 *   distinct state — `loaded && empty` means every provider is disabled, so we
 *   return `[]` and the UI shows its empty state).
 */
export function selectActiveProviders(
  loaded: boolean,
  contribs: ProviderContribution[],
): ProviderMeta[] {
  if (!loaded) return FALLBACK_PROVIDERS;
  return providersFromContributions(contribs);
}

/**
 * Live active provider list, driven by the enabled provider plugins. Components
 * read this instead of the static const so disabling a provider plugin removes
 * it everywhere. Empty array = all providers disabled (handle the empty state).
 */
export function useProviders(): ProviderMeta[] {
  const loaded = usePlugins((s) => s.loaded);
  // Select the stable `plugins` reference (changes only on reload), then derive
  // in a memo. Selecting a freshly-built registry array directly would return a
  // new reference every render and loop zustand's Object.is subscription.
  const plugins = usePlugins((s) => s.plugins);
  // User-added OpenAI-compatible providers, appended after the built-ins. Their
  // ids never collide with built-ins (the store excludes KNOWN_PROVIDER_IDS).
  const custom = useCustomProviders((s) => s.providers);
  return useMemo(
    () => [
      ...selectActiveProviders(loaded, buildRegistry(plugins).providers),
      ...custom.map((c) => ({
        id: c.id,
        label: c.label,
        defaultModel: c.defaultModel,
        keyHint: "",
      })),
    ],
    [loaded, plugins, custom],
  );
}
