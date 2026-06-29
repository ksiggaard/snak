// Provider registry.
//
// The app ships with NO cloud providers: users add them (OpenAI, Anthropic,
// Mistral, Gemini, Groq, …) from the Custom Providers settings tab, optionally
// starting from a preset (see `providerPresets.ts`). Each added provider is a
// `CustomProvider` row carrying a wire `protocol`, so the Rust dispatch reuses
// the native Anthropic/Gemini modules — not just the OpenAI-compatible engine.
//
// The one remaining built-in is local **Ollama** — a keyless provider plugin
// (descriptor in src-tauri/src/plugins/builtin/ollama.json) with its own daemon
// UI. `useProviders()` returns the enabled provider contributions (just Ollama)
// plus the user's custom providers. An empty result is a valid state (nothing
// configured) handled by the consumers (see ModelChooser / Composer / ChatView).

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
 * The provider ids the Rust dispatch (`providers::stream`) resolves *by id* — now
 * just local Ollama (cloud providers are dispatched by their `protocol` instead).
 * Provider-plugin contributions are filtered to this set, and custom-provider ids
 * are kept clear of it so a user entry can never shadow the built-in Ollama.
 */
export const KNOWN_PROVIDER_IDS = ["ollama"] as const;

function isKnownProvider(id: string): id is Provider {
  return (KNOWN_PROVIDER_IDS as readonly string[]).includes(id);
}

/**
 * The built-in provider(s) shown before the plugin registry has loaded — now just
 * keyless local Ollama (`keyHint: ""`, so no key row is ever rendered). Cloud
 * providers are user-added (see `providerPresets.ts`), so this is intentionally
 * NOT the source of the cloud list anymore.
 */
export const FALLBACK_PROVIDERS: ProviderMeta[] = [
  {
    id: "ollama",
    label: "Local (Ollama)",
    defaultModel: "llama3.2:1b",
    keyHint: "",
  },
];

/** Back-compat alias for the static built-in list. */
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
  // User-added providers, appended after the built-in (Ollama). Their ids never
  // collide with the built-in (the store excludes KNOWN_PROVIDER_IDS).
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

/**
 * Non-hook snapshot of the active provider list — same composition as
 * `useProviders` (enabled provider-plugin contributions, i.e. just Ollama, plus
 * the user's custom providers). For stores/helpers that run outside React (e.g.
 * the threads store's default resolution). Reads the stores' current snapshots.
 */
export function activeProviders(): ProviderMeta[] {
  const { loaded, plugins } = usePlugins.getState();
  const custom = useCustomProviders.getState().providers;
  return [
    ...selectActiveProviders(loaded, buildRegistry(plugins).providers),
    ...custom.map((c) => ({
      id: c.id,
      label: c.label,
      defaultModel: c.defaultModel,
      keyHint: "",
    })),
  ];
}
