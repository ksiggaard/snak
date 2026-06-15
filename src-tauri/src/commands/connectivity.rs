//! Internet reachability probe (offline mode). Mirrors the `ollama` daemon
//! probe (`commands/ollama.rs`): a short-timeout HTTP check that NEVER errors —
//! "no internet" is a normal, expected state, reported as `online: false`.
//!
//! The frontend `useConnectivity` store calls this on startup, on the browser
//! `online`/`offline` events, and on a focused interval. The result gates cloud
//! providers + internet-requiring MCP tools (`web`, `youtube`); local tooling
//! (Ollama, the read-only `sys` server, renderers) stays available offline.

use std::time::Duration;

use futures_util::future::select_ok;

/// Per-attempt timeout. A reachable host answers in well under a second; 2.5s
/// caps the wait when the network is blackholed (dropped, not refused) instead
/// of letting a doomed request hang the probe.
const TIMEOUT: Duration = Duration::from_millis(2500);

/// Endpoints raced in parallel — *any one* answering proves connectivity, so a
/// single host's outage never reads as "offline". Both are tiny, highly
/// available, and purpose-built/cheap for connectivity checks:
/// - gstatic `generate_204` returns an empty 204;
/// - cloudflare `cdn-cgi/trace` returns a small text body.
///
/// Reachability = we received *any* HTTP response (even a 4xx/5xx proves DNS +
/// routing + TLS work); only a connection/timeout/DNS failure counts as offline.
const PROBE_URLS: &[&str] = &[
    "https://www.gstatic.com/generate_204",
    "https://cloudflare.com/cdn-cgi/trace",
];

/// Internet reachability as reported to the frontend.
#[derive(serde::Serialize)]
pub struct Connectivity {
    pub online: bool,
}

/// Probe internet reachability. Never errors — unreachable is a normal state,
/// reported as `online: false` (same contract as `ollama_status`).
#[tauri::command]
pub async fn connectivity_probe() -> Result<Connectivity, String> {
    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(Connectivity {
        online: race_any_ok(&client, PROBE_URLS).await,
    })
}

/// Fire the probes concurrently and resolve `true` as soon as ANY one gets a
/// response; `false` only if every endpoint fails (connection/timeout/DNS).
async fn race_any_ok(client: &reqwest::Client, urls: &[&str]) -> bool {
    if urls.is_empty() {
        return false;
    }
    // Box::pin so each future is `Unpin` (required by `select_ok`). A received
    // response (any status) is success; transport failure is the only "offline".
    let probes = urls.iter().map(|url| {
        Box::pin(async move {
            client
                .get(*url)
                .send()
                .await
                .map(|_| ())
                .map_err(|e| e.to_string())
        })
    });
    select_ok(probes).await.is_ok()
}
