import { invoke } from "@tauri-apps/api/core";
import type { Provider } from "@/types/db";

// Thin wrappers over the Rust keychain commands. The key is only ever sent
// *into* Rust via `setApiKey`; it is never read back into the webview.
//
// Presence ("does provider X have a key?") for the UI comes from the cached
// `useKeys` store, NOT these wrappers: `readApiKeyPresence` reads the secret out
// of the keychain to report a bool and so triggers an OS keychain authorization
// prompt, so it's used only by that store's one-time backfill — never on the
// hot path. `setApiKey`/`deleteApiKey` keep the keychain authoritative; callers
// mirror the change into the store via `useKeys.setPresent`.

export const setApiKey = (provider: Provider, key: string): Promise<void> =>
  invoke("set_api_key", { provider, key });

export const deleteApiKey = (provider: Provider): Promise<void> =>
  invoke("delete_api_key", { provider });

/**
 * Report whether a key is stored, by reading it from the OS keychain. This
 * **triggers an OS keychain authorization prompt**, so it must only be used by
 * the one-time presence backfill in `useKeys` (`store/keys.ts`); everything else
 * reads the cached presence from that store.
 */
export const readApiKeyPresence = (provider: Provider): Promise<boolean> =>
  invoke("has_api_key", { provider });
