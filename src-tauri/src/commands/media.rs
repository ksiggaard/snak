//! Media-playback capability probe.
//!
//! In-app `<video>`/`<audio>` (the YouTube embeds plugin) plays through the
//! webview's media backend. On Linux that is WebKitGTK's GStreamer pipeline,
//! which needs the `autodetect` plugin (`autoaudiosink`); without it the
//! WebKitWebProcess **crashes** when a video starts. So before mounting a
//! player the frontend asks here whether inline playback is safe — when it
//! isn't, the embed falls back to opening the video in the system browser
//! (which has its own codecs) instead of crashing.
//!
//! macOS/Windows don't use GStreamer for webview media, so they always report
//! available.

/// True when inline media playback is expected to work in the webview.
///
/// Linux: probes for the GStreamer `autoaudiosink` element via
/// `gst-inspect-1.0` (shipped with the `gstreamer` core that WebKitGTK already
/// depends on). A non-zero exit / missing tool is treated as unavailable so the
/// caller degrades gracefully rather than risking the webview crash.
#[tauri::command]
pub fn media_playback_available() -> bool {
    probe()
}

#[cfg(target_os = "linux")]
fn probe() -> bool {
    std::process::Command::new("gst-inspect-1.0")
        .arg("autoaudiosink")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[cfg(not(target_os = "linux"))]
fn probe() -> bool {
    true
}
