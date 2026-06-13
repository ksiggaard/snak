import { create } from "zustand";
import { addModel, deleteModel, listModels } from "@/lib/db";
import {
  getOllamaStatus,
  listOllamaModels,
  listOllamaRunning,
  reconcileOllamaModels,
  startOllama,
  unloadOllamaModel,
  type OllamaModelInfo,
  type OllamaRunningModelInfo,
} from "@/lib/ollama";
import { useModels } from "@/store/models";

// Local Ollama daemon state (T37, + daemon controls T41). `refresh()` probes
// the daemon and, when it answers, syncs its installed models into the `models`
// table (so they show up in the model picker like any configured model) and
// reads the currently-loaded models (`/api/ps`). When the daemon is down we
// only flip the status — the rows are NEVER removed on a failed probe, so a
// temporarily-stopped daemon doesn't wipe the user's picker entries.

/** Short delay used while polling for the daemon to come up after start. */
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface OllamaState {
  /** Daemon reachability: unknown until the first probe answers. */
  status: "unknown" | "ok" | "down";
  /** Daemon version when running (shown in settings). */
  version: string | null;
  /** Installed models as reported by the daemon (settings list). */
  models: OllamaModelInfo[];
  /** Models currently loaded in memory (`/api/ps`, T41). */
  running: OllamaRunningModelInfo[];
  /** A probe is in flight (disables the Refresh button). */
  refreshing: boolean;
  /** A start-daemon attempt is in flight (T41). */
  starting: boolean;
  /** A non-fatal control error (start/unload), shown in the card (T41). */
  error: string | null;
  /** Probe the daemon; on success, reconcile the models table and reload it. */
  refresh: () => Promise<void>;
  /** Start the daemon and poll until it answers (or give up) (T41). */
  start: () => Promise<void>;
  /** Unload a loaded model from memory, then refresh (T41). */
  unload: (name: string) => Promise<void>;
}

export const useOllama = create<OllamaState>((set, get) => ({
  status: "unknown",
  version: null,
  models: [],
  running: [],
  refreshing: false,
  starting: false,
  error: null,

  refresh: async () => {
    set({ refreshing: true });
    try {
      const status = await getOllamaStatus();
      if (!status.running) {
        set({ status: "down", version: null, running: [] });
        return;
      }
      const installed = await listOllamaModels();
      // Sync installed models into the models table (name = id = label), then
      // reload the models store so the picker reflects the change.
      const { toAdd, toRemove } = reconcileOllamaModels(
        await listModels(),
        installed.map((m) => m.name),
      );
      for (const name of toAdd) {
        await addModel({ provider: "ollama", modelId: name, label: name });
      }
      for (const row of toRemove) await deleteModel(row.id);
      if (toAdd.length > 0 || toRemove.length > 0) {
        await useModels.getState().load();
      }
      // Loaded-models list (T41): best-effort — a failure here must not flip
      // the daemon to "down", so fall back to an empty list.
      let running: OllamaRunningModelInfo[] = [];
      try {
        running = await listOllamaRunning();
      } catch {
        running = [];
      }
      set({
        status: "ok",
        version: status.version,
        models: installed,
        running,
      });
    } catch {
      // Probe/list failed mid-flight — treat as down; keep existing rows.
      set({ status: "down", version: null, running: [] });
    } finally {
      set({ refreshing: false });
    }
  },

  start: async () => {
    if (get().starting) return;
    set({ starting: true, error: null });
    try {
      await startOllama();
      // The daemon needs a moment to bind its port; poll a few times until it
      // answers (or give up — the user can hit Refresh).
      for (let i = 0; i < 6; i++) {
        await delay(700);
        await get().refresh();
        if (get().status === "ok") break;
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ starting: false });
    }
  },

  unload: async (name) => {
    set({ error: null });
    try {
      await unloadOllamaModel(name);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
    await get().refresh();
  },
}));
