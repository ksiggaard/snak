//! API-key storage backed by the OS keychain.
//!
//! Keys are written to / read from the platform secret store and are never
//! returned to the webview. `has_api_key` reports only presence; the secret
//! itself stays in the Rust process and the keychain.

use keyring::{Entry, Error as KeyringError};

/// Keychain service name. Keys are stored per provider under this service,
/// with the provider id (e.g. "anthropic") as the account/username.
const SERVICE: &str = "com.snak.app";

fn entry(provider: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, provider).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_api_key(provider: String, key: String) -> Result<(), String> {
    entry(&provider)?
        .set_password(&key)
        .map_err(|e| e.to_string())
}

/// Returns whether a key is stored for the provider. Never returns the key.
#[tauri::command]
pub fn has_api_key(provider: String) -> Result<bool, String> {
    match entry(&provider)?.get_password() {
        Ok(_) => Ok(true),
        Err(KeyringError::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

/// Read the stored key for in-process use (e.g. provider calls). Crate-internal
/// only — this is never exposed as a command, so keys don't reach the webview.
pub(crate) fn get_api_key(provider: &str) -> Result<Option<String>, String> {
    match entry(provider)?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn delete_api_key(provider: String) -> Result<(), String> {
    match entry(&provider)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
