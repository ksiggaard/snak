import { create } from "zustand";
import { addModel, deleteModel, listModels } from "@/lib/db";
import {
  getOllamaStatus,
  listOllamaModels,
  reconcileOllamaModels,
  type OllamaModelInfo,
} from "@/lib/ollama";
import { useModels } from "@/store/models";

// Local Ollama daemon state (T37). `refresh()` probes the daemon and, when it
// answers, syncs its installed models into the `models` table (so they show up
// in the model picker like any configured model). When the daemon is down we
// only flip the status — the rows are NEVER removed on a failed probe, so a
// temporarily-stopped daemon doesn't wipe the user's picker entries.

interface OllamaState {
  /** Daemon reachability: unknown until the first probe answers. */
  status: "unknown" | "ok" | "down";
  /** Daemon version when running (shown in settings). */
  version: string | null;
  /** Installed models as reported by the daemon (settings list). */
  models: OllamaModelInfo[];
  /** A probe is in flight (disables the Refresh button). */
  refreshing: boolean;
  /** Probe the daemon; on success, reconcile the models table and reload it. */
  refresh: () => Promise<void>;
}

export const useOllama = create<OllamaState>((set) => ({
  status: "unknown",
  version: null,
  models: [],
  refreshing: false,

  refresh: async () => {
    set({ refreshing: true });
    try {
      const status = await getOllamaStatus();
      if (!status.running) {
        set({ status: "down", version: null });
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
      set({ status: "ok", version: status.version, models: installed });
    } catch {
      // Probe/list failed mid-flight — treat as down; keep existing rows.
      set({ status: "down", version: null });
    } finally {
      set({ refreshing: false });
    }
  },
}));
