//! Ollama discovery + daemon controls (T37, T41). The probes hit the *native*
//! daemon API on localhost with a short timeout so the UI stays snappy whether
//! or not the daemon is installed. Chat itself goes through the provider layer
//! (`providers::ollama`), not these commands.
//!
//! ## Daemon lifecycle (T41) — decision
//! - **Start** spawns the `ollama serve` CLI as a detached child (the same
//!   "spawn a fixed OS binary" pattern as `take_screenshot` → `spectacle`).
//!   snak does NOT manage platform service units (systemd `--user`/system,
//!   macOS login item): those vary by install method, while a spawned `serve`
//!   works regardless.
//! - **Stop** is deliberately offered only at the *model* level (unload a
//!   loaded model), never as a daemon kill: the daemon may be a system-managed
//!   service snak didn't start, so killing it would be destructive and
//!   unreliable. Unloading a model is safe and reversible (it reloads on next
//!   use).
//!
//! Both spawn the fixed `ollama` binary with arguments passed as argv (never a
//! shell string), so there is no command-injection surface.

use std::time::Duration;

use crate::providers::ollama::{self, OllamaModel, OllamaRunningModel};

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

/// List the models currently loaded in memory (`/api/ps`, T41).
#[tauri::command]
pub async fn ollama_ps() -> Result<Vec<OllamaRunningModel>, String> {
    let client = client()?;
    ollama::fetch_running(&client)
        .await
        .map_err(|e| ollama::friendly_connect_error(e).to_string())
}

/// Friendly "ollama not installed" message, shared by the spawn commands.
fn not_installed_error() -> String {
    "Ollama isn't installed (the `ollama` command wasn't found). Install it from \
     https://ollama.com/download."
        .into()
}

/// Start the daemon by spawning `ollama serve` detached (T41). Returns once the
/// child is spawned — the daemon takes a moment to bind its port, so the
/// frontend polls `ollama_status` afterwards. A missing binary is reported with
/// an actionable install message; an already-running daemon makes `serve` exit
/// on its own (harmless — the Start button only shows while it's down).
#[tauri::command]
pub fn ollama_start() -> Result<(), String> {
    match std::process::Command::new("ollama").arg("serve").spawn() {
        Ok(_child) => Ok(()), // detached; we intentionally don't wait or track it
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(not_installed_error()),
        Err(e) => Err(format!("couldn't start Ollama: {e}")),
    }
}

/// Unload a loaded model from memory via `ollama stop <model>` (T41). The name
/// is validated (it comes from the daemon's own `/api/ps`, but we guard anyway)
/// and passed as a single argv entry — never a shell string. Waits for the
/// short command to finish so the caller can refresh `/api/ps` afterwards.
#[tauri::command]
pub async fn ollama_unload(model: String) -> Result<(), String> {
    let name = model.trim();
    if name.is_empty() || name.split_whitespace().count() != 1 {
        return Err("invalid model name".into());
    }
    let out = match tokio::process::Command::new("ollama")
        .arg("stop")
        .arg(name)
        .output()
        .await
    {
        Ok(out) => out,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(not_installed_error()),
        Err(e) => return Err(format!("couldn't unload model: {e}")),
    };
    if out.status.success() {
        Ok(())
    } else {
        Err(format!(
            "ollama stop failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}
