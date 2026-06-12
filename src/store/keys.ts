import { create } from "zustand";
import { getSetting, setSetting } from "@/lib/db";
import { readApiKeyPresence } from "@/lib/keys";
import { isKeylessProvider, KNOWN_PROVIDER_IDS } from "@/lib/providers";
import type { Provider } from "@/types/db";

// Key *presence* ("does provider X have a stored API key?") is cached in the
// SQLite `settings` table so the UI can gate on it without reading the secret
// out of the OS keychain. Reading the secret triggers an OS authorization
// prompt on every access (notably macOS), which previously fired once per
// stored key at startup just to populate the model picker / composer / API-key
// settings. The keychain is now only read on an actual chat send (Rust
// `get_api_key`), plus a single one-time backfill for installs created before
// this cache existed. Consumers subscribe to this store, so the backfill can't
// race the first paint — when it finishes, the `present` set updates reactively.

/** settings key holding the cached "has a key" flag (`"1"`/`"0"`) per provider. */
export const presenceKey = (provider: Provider): string =>
  `apikey_present_${provider}`;

/** settings flag marking that the one-time keychain→cache backfill has run. */
export const PRESENCE_SYNCED_KEY = "apikey_present_synced";

interface KeysState {
  /** Providers with a stored key. Derived from the cache; no keychain reads. */
  present: Set<Provider>;
  /** False until the cache has been read (UI shows a brief "checking" state). */
  loaded: boolean;
  /**
   * Populate `present` from the settings cache. On an install created before the
   * cache existed (`PRESENCE_SYNCED_KEY` unset), reconcile once from the OS
   * keychain — the *only* startup path that touches the keychain, so it prompts
   * a single time — then the cache is authoritative on every later launch.
   */
  load: () => Promise<void>;
  /**
   * Record a provider's key as present/absent — writes the cache and updates
   * state. Call after a successful `setApiKey` / `deleteApiKey`.
   */
  setPresent: (provider: Provider, present: boolean) => Promise<void>;
}

// Keyless providers (e.g. local Ollama, T37) have no key to cache or read —
// they're gated on daemon reachability instead (`useOllama`), so the presence
// machinery skips them entirely.
const KEYED_PROVIDER_IDS = KNOWN_PROVIDER_IDS.filter(
  (id) => !isKeylessProvider(id),
);

export const useKeys = create<KeysState>((set) => ({
  present: new Set(),
  loaded: false,

  load: async () => {
    // One-time backfill: a pre-cache install has no flags, so read the keychain
    // once per known provider and persist the result (guarded so it never reads
    // the keychain again on subsequent launches).
    if ((await getSetting(PRESENCE_SYNCED_KEY)) !== "1") {
      await Promise.all(
        KEYED_PROVIDER_IDS.map(async (provider) => {
          const has = await readApiKeyPresence(provider);
          await setSetting(presenceKey(provider), has ? "1" : "0");
        }),
      );
      await setSetting(PRESENCE_SYNCED_KEY, "1");
    }
    // Read the cached flags (pure DB — no keychain access).
    const pairs = await Promise.all(
      KEYED_PROVIDER_IDS.map(
        async (provider) =>
          [
            provider,
            (await getSetting(presenceKey(provider))) === "1",
          ] as const,
      ),
    );
    set({
      present: new Set(pairs.filter(([, ok]) => ok).map(([p]) => p)),
      loaded: true,
    });
  },

  setPresent: async (provider, present) => {
    await setSetting(presenceKey(provider), present ? "1" : "0");
    set((s) => {
      const next = new Set(s.present);
      if (present) next.add(provider);
      else next.delete(provider);
      return { present: next };
    });
  },
}));
