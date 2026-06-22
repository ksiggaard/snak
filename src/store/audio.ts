import { create } from "zustand";
import { getSetting, setSetting } from "@/lib/db";
import { audioStatus, type AudioStatus } from "@/lib/audio";
import { DEFAULT_STT_MODEL, DEFAULT_TTS_VOICE } from "@/lib/audioModels";

// Audio plugin settings: the selected TTS voice + STT model and the local-tool
// availability snapshot. Selections persist in the `settings` table (not the
// plugin's enabled state, which is Rust-owned) so they survive restarts and are
// read by both the settings card and the chat buttons.

const TTS_VOICE_KEY = "audio_tts_voice";
const STT_MODEL_KEY = "audio_stt_model";

interface AudioState {
  /** Selected Piper voice id (file stem). */
  ttsVoice: string;
  /** Selected whisper.cpp model id. */
  sttModel: string;
  /** Latest availability probe (null until first load). */
  status: AudioStatus | null;
  /** Settings + first probe have completed. */
  loaded: boolean;

  /** Read persisted selections and probe tool availability. */
  load: () => Promise<void>;
  /** Re-probe tool/model availability (after an install). */
  refreshStatus: () => Promise<void>;
  setTtsVoice: (id: string) => Promise<void>;
  setSttModel: (id: string) => Promise<void>;
}

export const useAudio = create<AudioState>((set) => ({
  ttsVoice: DEFAULT_TTS_VOICE,
  sttModel: DEFAULT_STT_MODEL,
  status: null,
  loaded: false,

  load: async () => {
    const [voice, model] = await Promise.all([
      getSetting(TTS_VOICE_KEY),
      getSetting(STT_MODEL_KEY),
    ]);
    let status: AudioStatus | null;
    try {
      status = await audioStatus();
    } catch {
      status = null;
    }
    set({
      ttsVoice: voice ?? DEFAULT_TTS_VOICE,
      sttModel: model ?? DEFAULT_STT_MODEL,
      status,
      loaded: true,
    });
  },

  refreshStatus: async () => {
    try {
      set({ status: await audioStatus() });
    } catch {
      set({ status: null });
    }
  },

  setTtsVoice: async (id) => {
    await setSetting(TTS_VOICE_KEY, id);
    set({ ttsVoice: id });
  },

  setSttModel: async (id) => {
    await setSetting(STT_MODEL_KEY, id);
    set({ sttModel: id });
  },
}));
