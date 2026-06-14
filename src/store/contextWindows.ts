import { create } from "zustand";
import { getModelContextWindows, setModelContextWindows } from "@/lib/db";

// T53 (IDEA 24) — user-configured per-model max context windows. Empty by
// default; when the active model has an entry the composer's context readout
// shows a `used / max (%)` bar instead of just an estimate. Stored in the
// SQLite settings table (frontend owns SQL) as a JSON `{ model: maxTokens }`.

interface ContextWindowsState {
  windows: Record<string, number>;
  loaded: boolean;
  error: string | null;

  /** Load (or reload) the map from the settings table. */
  load: () => Promise<void>;
  /** Set (or overwrite) a model's max window, then persist. */
  setWindow: (model: string, maxTokens: number) => Promise<void>;
  /** Remove a model's entry, then persist. */
  removeWindow: (model: string) => Promise<void>;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useContextWindows = create<ContextWindowsState>((set, get) => ({
  windows: {},
  loaded: false,
  error: null,

  load: async () => {
    try {
      const windows = await getModelContextWindows();
      set({ windows, loaded: true, error: null });
    } catch (e) {
      set({ error: errMsg(e), loaded: true });
    }
  },

  setWindow: async (model, maxTokens) => {
    const next = { ...get().windows, [model]: maxTokens };
    set({ windows: next });
    try {
      await setModelContextWindows(next);
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  removeWindow: async (model) => {
    const next = { ...get().windows };
    delete next[model];
    set({ windows: next });
    try {
      await setModelContextWindows(next);
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },
}));
