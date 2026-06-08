import { invoke } from "@tauri-apps/api/core";
import type { Provider } from "@/types/db";

// Thin wrappers over the Rust keychain commands. The key is only ever sent
// *into* Rust via `setApiKey`; it is never read back into the webview.

export const setApiKey = (provider: Provider, key: string): Promise<void> =>
  invoke("set_api_key", { provider, key });

export const hasApiKey = (provider: Provider): Promise<boolean> =>
  invoke("has_api_key", { provider });

export const deleteApiKey = (provider: Provider): Promise<void> =>
  invoke("delete_api_key", { provider });
