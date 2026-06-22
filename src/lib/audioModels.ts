// Curated local-model registry for the audio plugin, plus the install commands
// the Audio settings card stages in a terminal (never auto-run — same pattern as
// the Ollama "pull" chips). Models download into the app-data audio dir so the
// Rust commands can resolve them by id (see src-tauri/src/commands/audio.rs).

/** A Piper TTS voice. `id` is the file stem; `path` is its dir under the
 *  rhasspy/piper-voices HF repo (lang/locale/name/quality). */
export interface PiperVoice {
  id: string;
  label: string;
  /** Approx download size, untranslated hint. */
  size: string;
  /** Path segment under the HF repo, e.g. "en/en_US/amy/medium". */
  path: string;
}

/** A whisper.cpp STT model. `id` maps to `ggml-<id>.bin`. */
export interface WhisperModel {
  id: string;
  label: string;
  size: string;
}

/** Default selections — small, fast, good-quality, English-friendly. */
export const DEFAULT_TTS_VOICE = "en_US-amy-medium";
export const DEFAULT_STT_MODEL = "base";

/** Curated Piper voices (download from huggingface.co/rhasspy/piper-voices). */
export const PIPER_VOICES: PiperVoice[] = [
  {
    id: "en_US-amy-medium",
    label: "Amy (US English)",
    size: "~63 MB",
    path: "en/en_US/amy/medium",
  },
  {
    id: "en_US-lessac-medium",
    label: "Lessac (US English)",
    size: "~63 MB",
    path: "en/en_US/lessac/medium",
  },
  {
    id: "en_US-ryan-high",
    label: "Ryan (US English, high)",
    size: "~120 MB",
    path: "en/en_US/ryan/high",
  },
  {
    id: "en_GB-alan-medium",
    label: "Alan (British English)",
    size: "~63 MB",
    path: "en/en_GB/alan/medium",
  },
];

/** Curated whisper.cpp models (download from huggingface.co/ggerganov/whisper.cpp). */
export const WHISPER_MODELS: WhisperModel[] = [
  { id: "tiny", label: "Tiny", size: "~75 MB" },
  { id: "base", label: "Base", size: "~142 MB" },
  { id: "small", label: "Small", size: "~466 MB" },
  { id: "medium", label: "Medium", size: "~1.5 GB" },
  { id: "large-v3", label: "Large v3", size: "~3.1 GB" },
];

const PIPER_REPO = "https://huggingface.co/rhasspy/piper-voices/resolve/main";
const WHISPER_REPO =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

/** Shell-quote a path for the staged command (handles spaces in app-data dir). */
function q(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Command staged to download a Piper voice (`.onnx` + `.onnx.json`) into `dir`. */
export function piperVoiceInstallCommand(dir: string, v: PiperVoice): string {
  const base = `${PIPER_REPO}/${v.path}/${v.id}`;
  return (
    `mkdir -p ${q(dir)} && ` +
    `curl -L -o ${q(`${dir}/${v.id}.onnx`)} '${base}.onnx?download=true' && ` +
    `curl -L -o ${q(`${dir}/${v.id}.onnx.json`)} '${base}.onnx.json?download=true'`
  );
}

/** Command staged to download a whisper.cpp model (`ggml-<id>.bin`) into `dir`. */
export function whisperModelInstallCommand(
  dir: string,
  m: WhisperModel,
): string {
  return (
    `mkdir -p ${q(dir)} && ` +
    `curl -L -o ${q(`${dir}/ggml-${m.id}.bin`)} '${WHISPER_REPO}/ggml-${m.id}.bin'`
  );
}
