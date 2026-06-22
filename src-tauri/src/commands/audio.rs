//! Local speech commands for the `audio` plugin (TTS + STT).
//!
//! Everything here is **local and offline**: text-to-speech goes through
//! [Piper](https://github.com/rhasspy/piper) (neural `.onnx` voices) and
//! speech-to-text through [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
//! (`whisper-cli`, GGUF models). Both are fixed OS binaries invoked with argv
//! (never a shell string), so there is no command-injection surface — the same
//! pattern as the screenshot/Ollama spawns.
//!
//! Model files live under the app-data dir so install instructions (staged in a
//! terminal, see the Audio settings card) download into a predictable place:
//!   `<app_data>/audio/piper/<voice>.onnx`     (+ `<voice>.onnx.json`)
//!   `<app_data>/audio/whisper/ggml-<model>.bin`
//!
//! Commands degrade gracefully: `audio_status` never errors (a missing binary is
//! a normal "not installed yet" state), and the synth/transcribe commands return
//! an actionable install message instead of panicking.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// Availability snapshot shown in the Audio settings card. Never errors — a
/// missing binary or model dir is a normal state, reported as empty/false.
#[derive(serde::Serialize)]
pub struct AudioStatus {
    /// `piper` is on PATH.
    pub piper_installed: bool,
    /// `whisper-cli` is on PATH.
    pub whisper_installed: bool,
    /// Voice ids found under `<app_data>/audio/piper` (file stem of `*.onnx`).
    pub voices: Vec<String>,
    /// STT model ids found under `<app_data>/audio/whisper`
    /// (the `<x>` of `ggml-<x>.bin`).
    pub stt_models: Vec<String>,
}

/// `<app_data>/audio/piper` — where Piper voices (`*.onnx` + `*.onnx.json`) live.
fn piper_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("audio")
        .join("piper"))
}

/// `<app_data>/audio/whisper` — where whisper.cpp GGUF models live.
fn whisper_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("audio")
        .join("whisper"))
}

/// Candidate command names for each tool, most-preferred first. whisper.cpp's
/// CLI is `whisper-cli` (older builds shipped `whisper-cpp` / `main`); the Piper
/// pip package installs `piper` (some builds expose `piper-tts`).
const PIPER_BINS: &[&str] = &["piper", "piper-tts"];
const WHISPER_BINS: &[&str] = &["whisper-cli", "whisper-cpp", "main"];

/// Directories to search for a tool: every `$PATH` entry plus the common install
/// locations a *GUI* app's minimal PATH usually omits — Homebrew (Linux/macOS),
/// and the per-user `~/.local/bin` (pipx), `~/.cargo/bin`, `~/bin`. Resolving the
/// absolute path here means detection *and* later spawning both work regardless
/// of how the app was launched (desktop launcher vs. shell).
fn binary_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    for extra in [
        "/home/linuxbrew/.linuxbrew/bin",
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
    ] {
        dirs.push(PathBuf::from(extra));
    }
    for var in ["HOME", "USERPROFILE"] {
        if let Some(home) = std::env::var_os(var) {
            let home = PathBuf::from(home);
            dirs.push(home.join(".local").join("bin"));
            dirs.push(home.join(".cargo").join("bin"));
            dirs.push(home.join(".linuxbrew").join("bin"));
            dirs.push(home.join("bin"));
        }
    }
    dirs
}

/// First `names` candidate found as an executable file across [`binary_dirs`],
/// returned as an absolute path (also tries a `.exe` suffix for Windows).
fn resolve_binary(names: &[&str]) -> Option<PathBuf> {
    let dirs = binary_dirs();
    for name in names {
        for dir in &dirs {
            for file in [name.to_string(), format!("{name}.exe")] {
                let candidate = dir.join(&file);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

/// Names of files in `dir` whose extension is `ext`, mapped through `map` on the
/// file stem. Missing dir → empty (a normal "nothing installed yet" state).
fn list_models(dir: &PathBuf, ext: &str) -> Vec<String> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some(ext) {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                out.push(stem.to_string());
            }
        }
    }
    out.sort();
    out
}

/// Probe Piper/whisper availability and list installed models. Never errors.
#[tauri::command]
pub fn audio_status(app: AppHandle) -> AudioStatus {
    let voices = piper_dir(&app)
        .map(|d| list_models(&d, "onnx"))
        .unwrap_or_default();
    // whisper models are `ggml-<id>.bin`; strip the `ggml-` prefix for display.
    let stt_models = whisper_dir(&app)
        .map(|d| {
            list_models(&d, "bin")
                .into_iter()
                .map(|s| s.strip_prefix("ggml-").map(str::to_string).unwrap_or(s))
                .collect()
        })
        .unwrap_or_default();
    AudioStatus {
        piper_installed: resolve_binary(PIPER_BINS).is_some(),
        whisper_installed: resolve_binary(WHISPER_BINS).is_some(),
        voices,
        stt_models,
    }
}

/// Reject ids that could escape the model dir or aren't a bare token. Models are
/// chosen from a curated list / the on-disk listing, but we guard regardless
/// since the value crosses the command boundary.
fn valid_model_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && !id.contains("..")
}

/// Synthesize `text` to a WAV byte buffer with the Piper `voice` (a file stem
/// under the app-data piper dir). Returns raw WAV bytes for the frontend to play
/// via the Web Audio API.
#[tauri::command]
pub async fn tts_synthesize(
    app: AppHandle,
    text: String,
    voice: String,
) -> Result<Vec<u8>, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("nothing to speak".into());
    }
    if !valid_model_id(&voice) {
        return Err("invalid voice id".into());
    }
    let model = piper_dir(&app)?.join(format!("{voice}.onnx"));
    if !model.exists() {
        return Err(format!(
            "Piper voice `{voice}` isn't installed. Add it from the Audio settings."
        ));
    }
    let piper = resolve_binary(PIPER_BINS).ok_or_else(piper_not_installed)?;

    // `--output_file -` makes Piper write a WAV stream to stdout; text is fed on
    // stdin so it never touches argv (length/charset safe).
    use tokio::io::AsyncWriteExt;
    let mut child = match tokio::process::Command::new(&piper)
        .arg("--model")
        .arg(&model)
        .arg("--output_file")
        .arg("-")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(piper_not_installed()),
        Err(e) => return Err(format!("couldn't start Piper: {e}")),
    };
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(text.as_bytes())
            .await
            .map_err(|e| format!("writing text to Piper: {e}"))?;
        // Drop stdin to signal EOF so Piper synthesizes and exits.
    }
    let out = child
        .wait_with_output()
        .await
        .map_err(|e| format!("Piper failed: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "Piper failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    if out.stdout.is_empty() {
        return Err("Piper produced no audio".into());
    }
    Ok(out.stdout)
}

/// Transcribe a recorded clip (`audio`, a WAV/WebM byte buffer from the webview
/// recorder) with the whisper.cpp `model` id (e.g. `base`). Returns the plain
/// transcript. `language` is an ISO code or `auto`.
#[tauri::command]
pub async fn stt_transcribe(
    app: AppHandle,
    audio: Vec<u8>,
    model: String,
    language: String,
) -> Result<String, String> {
    if audio.is_empty() {
        return Err("no audio to transcribe".into());
    }
    if !valid_model_id(&model) {
        return Err("invalid STT model id".into());
    }
    let model_path = whisper_dir(&app)?.join(format!("ggml-{model}.bin"));
    if !model_path.exists() {
        return Err(format!(
            "whisper.cpp model `{model}` isn't installed. Add it from the Audio settings."
        ));
    }
    let whisper = resolve_binary(WHISPER_BINS).ok_or_else(whisper_not_installed)?;

    // whisper-cli reads a file, so persist the clip to a unique temp path. Use
    // the process id to avoid collisions; clean up on the way out.
    let tmp = std::env::temp_dir().join(format!("snak-stt-{}.wav", std::process::id()));
    std::fs::write(&tmp, &audio).map_err(|e| format!("writing temp audio: {e}"))?;

    let lang = if language.trim().is_empty() {
        "auto".to_string()
    } else {
        language.trim().to_string()
    };
    // `-nt` = no timestamps, `-otxt` writes `<tmp>.txt`; `-l` sets the language.
    let result = tokio::process::Command::new(&whisper)
        .arg("-m")
        .arg(&model_path)
        .arg("-f")
        .arg(&tmp)
        .arg("-l")
        .arg(&lang)
        .arg("-nt")
        .arg("-otxt")
        .output()
        .await;

    let transcript = match result {
        Ok(out) if out.status.success() => {
            // whisper-cli prints the transcript to stdout (and `<tmp>.txt`).
            let txt_path = PathBuf::from(format!("{}.txt", tmp.display()));
            let from_file = std::fs::read_to_string(&txt_path).ok();
            let _ = std::fs::remove_file(&txt_path);
            Ok(from_file.unwrap_or_else(|| String::from_utf8_lossy(&out.stdout).to_string()))
        }
        Ok(out) => Err(format!(
            "whisper-cli failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        )),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(whisper_not_installed()),
        Err(e) => Err(format!("whisper-cli failed: {e}")),
    };
    let _ = std::fs::remove_file(&tmp);
    transcript.map(|t| t.trim().to_string())
}

fn piper_not_installed() -> String {
    "Piper isn't installed (the `piper` command wasn't found). See the Audio settings \
     for install instructions."
        .into()
}

fn whisper_not_installed() -> String {
    "whisper.cpp isn't installed (the `whisper-cli` command wasn't found). See the Audio \
     settings for install instructions."
        .into()
}

#[cfg(test)]
mod tests {
    use super::valid_model_id;

    #[test]
    fn accepts_plain_ids() {
        assert!(valid_model_id("base"));
        assert!(valid_model_id("en_US-amy-medium"));
        assert!(valid_model_id("ggml-small.en"));
    }

    #[test]
    fn rejects_traversal_and_empty() {
        assert!(!valid_model_id(""));
        assert!(!valid_model_id("../etc/passwd"));
        assert!(!valid_model_id("a/b"));
        assert!(!valid_model_id("with space"));
    }
}
