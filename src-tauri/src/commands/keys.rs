//! API-key storage backed by the OS keychain.
//!
//! Keys are written to / read from the platform secret store and are never
//! returned to the webview. `has_api_key` reports only presence; the secret
//! itself stays in the Rust process and the keychain.

use std::collections::HashMap;
use std::sync::Mutex;

use keyring::{Entry, Error as KeyringError};
use tauri::State;

/// Keychain service name. Keys are stored per provider under this service,
/// with the provider id (e.g. "anthropic") as the account/username.
const SERVICE: &str = "com.snak.app";

fn entry(provider: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, provider).map_err(|e| e.to_string())
}

/// In-process cache of API keys, keyed by provider id. Held in Tauri managed
/// state (one per app run).
///
/// **Why this exists:** every keychain read can trigger an OS authorization
/// prompt — on macOS, because the app is ad-hoc/linker-signed, its keychain
/// trust is pinned to the exact binary hash and so does *not* persist, the
/// prompt reappears on each access. Reading the key on every chat send made
/// the app ask for the password repeatedly within a session. Caching the key
/// after the first successful read collapses that to at most one prompt per
/// provider per app run. The secret still never crosses into the webview.
#[derive(Default)]
pub struct KeyCache(Mutex<HashMap<String, String>>);

impl KeyCache {
    /// Return the cached key, or call `read` (the keychain) on a miss and cache
    /// a present result. Absence is intentionally **not** cached, so a key added
    /// later in the session is picked up without restarting.
    fn get_or_read<F>(&self, provider: &str, read: F) -> Result<Option<String>, String>
    where
        F: FnOnce() -> Result<Option<String>, String>,
    {
        if let Some(key) = self.0.lock().unwrap().get(provider) {
            return Ok(Some(key.clone()));
        }
        match read()? {
            Some(key) => {
                self.0
                    .lock()
                    .unwrap()
                    .insert(provider.to_string(), key.clone());
                Ok(Some(key))
            }
            None => Ok(None),
        }
    }

    /// Warm/overwrite the cached key for a provider (after a successful write).
    fn store(&self, provider: &str, key: &str) {
        self.0
            .lock()
            .unwrap()
            .insert(provider.to_string(), key.to_string());
    }

    /// Drop a provider's cached key (after a delete), forcing a fresh read.
    fn invalidate(&self, provider: &str) {
        self.0.lock().unwrap().remove(provider);
    }
}

#[tauri::command]
pub async fn set_api_key(
    provider: String,
    key: String,
    cache: State<'_, KeyCache>,
) -> Result<(), String> {
    let p = provider.clone();
    let k = key.clone();
    tokio::task::spawn_blocking(move || {
        entry(&p)?.set_password(&k).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("keychain write failed: {e}"))??;
    cache.store(&provider, &key);
    Ok(())
}

/// Returns whether a key is stored for the provider. Never returns the key.
#[tauri::command]
pub async fn has_api_key(provider: String) -> Result<bool, String> {
    let p = provider.clone();
    tokio::task::spawn_blocking(move || {
        match entry(&p)?.get_password() {
            Ok(_) => Ok(true),
            Err(KeyringError::NoEntry) => Ok(false),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| format!("keychain read failed: {e}"))?
}

/// Read the stored key for in-process use (e.g. provider calls). Crate-internal
/// only — this is never exposed as a command, so keys don't reach the webview.
/// This is the *uncached* keychain read; the chat path goes through
/// [`get_api_key_cached`] instead. Other callers (e.g. the web-search MCP tool)
/// read directly here — those are infrequent, not the hot per-message path.
pub(crate) fn get_api_key(provider: &str) -> Result<Option<String>, String> {
    match entry(provider)?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Read the key for in-process use, going through the [`KeyCache`] so the OS
/// keychain (and its authorization prompt) is touched at most once per provider
/// per app run. This is what the chat path uses; `get_api_key` is the uncached
/// keychain read behind it. Crate-internal — never exposed to the webview.
pub(crate) fn get_api_key_cached(
    cache: &KeyCache,
    provider: &str,
) -> Result<Option<String>, String> {
    cache.get_or_read(provider, || get_api_key(provider))
}

#[tauri::command]
pub async fn delete_api_key(provider: String, cache: State<'_, KeyCache>) -> Result<(), String> {
    let p = provider.clone();
    tokio::task::spawn_blocking(move || {
        match entry(&p)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| format!("keychain delete failed: {e}"))??;
    // Drop any cached copy regardless of the delete outcome.
    cache.invalidate(&provider);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // The cache must read the keychain (its OS authorization prompt) at most
    // once per provider per app run; later gets are served from memory.
    #[test]
    fn reads_keychain_only_once_per_provider() {
        let cache = KeyCache::default();
        let mut reads = 0;

        let first = cache
            .get_or_read("anthropic", || {
                reads += 1;
                Ok(Some("secret".to_string()))
            })
            .unwrap();
        // A second get must NOT invoke the reader — if it did, this closure's
        // different value would leak through.
        let second = cache
            .get_or_read("anthropic", || {
                reads += 1;
                Ok(Some("SHOULD-NOT-BE-USED".to_string()))
            })
            .unwrap();

        assert_eq!(first.as_deref(), Some("secret"));
        assert_eq!(second.as_deref(), Some("secret"));
        assert_eq!(reads, 1, "keychain should be read exactly once");
    }

    // An absent key is not negatively cached: a key added later (e.g. via the
    // settings UI) is picked up without restarting the app.
    #[test]
    fn absent_key_is_not_cached() {
        let cache = KeyCache::default();
        let mut reads = 0;

        let first = cache
            .get_or_read("openai", || {
                reads += 1;
                Ok(None)
            })
            .unwrap();
        let second = cache
            .get_or_read("openai", || {
                reads += 1;
                Ok(Some("added-later".to_string()))
            })
            .unwrap();

        assert_eq!(first, None);
        assert_eq!(second.as_deref(), Some("added-later"));
        assert_eq!(reads, 2, "absence must not be cached");
    }

    // `set_api_key` warms/overwrites the cache so a changed key takes effect
    // immediately and the next chat send never re-reads the keychain.
    #[test]
    fn store_overwrites_without_keychain_read() {
        let cache = KeyCache::default();
        cache.store("mistral", "old");
        cache.store("mistral", "new");

        let got = cache
            .get_or_read("mistral", || panic!("must not read keychain after store"))
            .unwrap();
        assert_eq!(got.as_deref(), Some("new"));
    }

    // `delete_api_key` invalidates the cache so a removed key forces a re-read
    // (which will report absence) rather than serving the stale secret.
    #[test]
    fn invalidate_forces_reread() {
        let cache = KeyCache::default();
        cache.store("gemini", "cached");
        cache.invalidate("gemini");

        let mut reads = 0;
        let got = cache
            .get_or_read("gemini", || {
                reads += 1;
                Ok(None)
            })
            .unwrap();
        assert_eq!(got, None);
        assert_eq!(reads, 1, "invalidated entry must be re-read");
    }
}
