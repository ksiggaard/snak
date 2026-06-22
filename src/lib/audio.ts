// Audio plugin helpers: thin wrappers over the Rust speech commands plus pure
// utilities (speakable-text extraction, WAV playback). All speech is local —
// Piper for TTS and whisper.cpp for STT (see src-tauri/src/commands/audio.rs).

import { invoke } from "@tauri-apps/api/core";

/** Availability + installed models, from Rust `audio_status`. Never rejects. */
export interface AudioStatus {
  piper_installed: boolean;
  whisper_installed: boolean;
  /** Installed Piper voice ids (file stems under the app-data piper dir). */
  voices: string[];
  /** Installed whisper.cpp model ids (e.g. "base", "small.en"). */
  stt_models: string[];
}

/** Probe Piper/whisper availability and list installed models. */
export const audioStatus = (): Promise<AudioStatus> => invoke("audio_status");

/** Synthesize `text` with Piper `voice`; resolves to WAV bytes. */
export const ttsSynthesize = (text: string, voice: string): Promise<number[]> =>
  invoke("tts_synthesize", { text, voice });

/** Transcribe a recorded clip with whisper.cpp; resolves to the transcript. */
export const sttTranscribe = (
  audio: number[],
  model: string,
  language: string,
): Promise<string> => invoke("stt_transcribe", { audio, model, language });

// --- Speakable-text extraction (pure, unit-tested) ---------------------------

/**
 * Reduce assistant markdown `content` to the plain prose a TTS engine should
 * read aloud. Reasoning is already a separate field on the message, so it is
 * excluded by construction; this strips the two things we must never read —
 * **fenced code blocks** — and unwraps markdown formatting to its visible text.
 *
 * Specifically it drops fenced code (``` … ```), HTML tags, images, table rows,
 * and heading/list/quote markers, and unwraps inline code, emphasis, and links
 * to the text a human would say.
 */
export function extractSpeakableText(content: string): string {
  let text = content;

  // Remove fenced code blocks entirely (``` or ~~~, with optional info string).
  text = text.replace(
    /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm,
    "",
  );
  // Drop any unterminated trailing fence (e.g. mid-stream) and its body.
  text = text.replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*$/m, "");

  // Markdown tables are data, not prose — drop rows that look like table lines.
  text = text.replace(/^\s*\|.*\|\s*$/gm, "");

  // Images: drop entirely (alt text is rarely worth reading).
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  // Links: keep the visible label, drop the URL.
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // Inline code → its text (without backticks).
  text = text.replace(/`([^`]+)`/g, "$1");
  // Bold / italic / strikethrough markers → text.
  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
  text = text.replace(/(\*|_)(.*?)\1/g, "$2");
  text = text.replace(/~~(.*?)~~/g, "$1");

  // Leftover raw HTML tags.
  text = text.replace(/<[^>]+>/g, "");

  // Line-level markers: headings, blockquotes, list bullets, ordered numbers,
  // and horizontal rules.
  text = text
    .split("\n")
    .map(
      (line) =>
        line
          .replace(/^\s{0,3}#{1,6}\s+/, "") // heading
          .replace(/^\s{0,3}>\s?/, "") // blockquote
          .replace(/^\s*[-*+]\s+/, "") // unordered list
          .replace(/^\s*\d+[.)]\s+/, "") // ordered list
          .replace(/^\s*([-*_])(\s*\1){2,}\s*$/, ""), // hr
    )
    .join("\n");

  // Collapse whitespace runs and blank lines into readable prose.
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join(". ")
    .trim();
}

// --- WAV playback ------------------------------------------------------------

/** A handle to in-flight playback: call `stop()` to cancel it immediately. */
export interface Playback {
  stop: () => void;
}

/**
 * Play raw WAV `bytes` and return a handle to stop it. Decoding goes through the
 * Web Audio API (`decodeAudioData`) for precise start/stop and to avoid the
 * WebKitGTK GStreamer `<audio>` caveats noted in AGENTS.md; on decode failure it
 * falls back to an `HTMLAudioElement` blob URL. `onEnded` fires on natural end
 * or error (not on an explicit `stop()`).
 */
export async function playWav(
  bytes: number[] | Uint8Array,
  onEnded?: () => void,
): Promise<Playback> {
  const u8 = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);

  try {
    const ctx = new AudioContext();
    // copy into a fresh ArrayBuffer so decodeAudioData owns it
    const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    const audioBuffer = await ctx.decodeAudioData(buf as ArrayBuffer);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    let stopped = false;
    source.onended = () => {
      if (stopped) return;
      void ctx.close();
      onEnded?.();
    };
    source.start();
    return {
      stop: () => {
        stopped = true;
        try {
          source.stop();
        } catch {
          // already stopped
        }
        void ctx.close();
      },
    };
  } catch {
    // Fallback: blob URL + <audio>.
    const blob = new Blob([u8], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    const el = new Audio(url);
    const cleanup = () => URL.revokeObjectURL(url);
    el.onended = () => {
      cleanup();
      onEnded?.();
    };
    el.onerror = () => {
      cleanup();
      onEnded?.();
    };
    void el.play();
    return {
      stop: () => {
        el.pause();
        cleanup();
      },
    };
  }
}
