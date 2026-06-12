//! Ollama discovery commands (T37). Both probe the *native* daemon API on
//! localhost with a short timeout so the UI stays snappy whether or not the
//! daemon is installed. Chat itself goes through the provider layer
//! (`providers::ollama`), not these commands.

use std::time::Duration;

use crate::providers::ollama::{self, OllamaModel};

/// Per-request timeout. Localhost answers (or refuses) near-instantly; 1.5s
/// caps the wait when the port is firewalled/blackholed instead of refused.
const TIMEOUT: Duration = Duration::from_millis(1500);

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| e.to_string())
}

/// Daemon health as shown in settings: reachable + reported version.
#[derive(serde::Serialize)]
pub struct OllamaStatus {
    pub running: bool,
    pub version: Option<String>,
}

/// Probe the local daemon. An unreachable daemon is a *normal* state (Ollama
/// not installed or not started), so this never errors — any failure reports
/// `running: false` instead.
#[tauri::command]
pub async fn ollama_status() -> Result<OllamaStatus, String> {
    let client = client()?;
    Ok(match ollama::fetch_version(&client).await {
        Ok(version) => OllamaStatus {
            running: true,
            version: Some(version),
        },
        Err(_) => OllamaStatus {
            running: false,
            version: None,
        },
    })
}

/// List the locally-installed models from the native `/api/tags` endpoint.
#[tauri::command]
pub async fn ollama_list_models() -> Result<Vec<OllamaModel>, String> {
    let client = client()?;
    ollama::fetch_models(&client)
        .await
        .map_err(|e| ollama::friendly_connect_error(e).to_string())
}
