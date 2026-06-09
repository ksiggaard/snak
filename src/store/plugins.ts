import { create } from "zustand";
import {
  buildRegistry,
  listPlugins,
  setPluginEnabled,
  uninstallPlugin,
  type HostRegistry,
} from "@/lib/plugins";
import type { PluginInfo } from "@/types/plugins";

interface PluginsState {
  plugins: PluginInfo[];
  loaded: boolean;
  error: string | null;

  /** Load (or reload) the installed plugins from the backend. */
  load: () => Promise<void>;
  /** Enable/disable a plugin (persisted backend-side), then refresh. */
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  /** Uninstall a user plugin (built-ins reject), then refresh. */
  uninstall: (id: string) => Promise<void>;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const usePlugins = create<PluginsState>((set, get) => ({
  plugins: [],
  loaded: false,
  error: null,

  load: async () => {
    try {
      const plugins = await listPlugins();
      set({ plugins, loaded: true, error: null });
    } catch (e) {
      set({ error: errMsg(e), loaded: true });
    }
  },

  setEnabled: async (id, enabled) => {
    try {
      await setPluginEnabled(id, enabled);
      await get().load();
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  uninstall: async (id) => {
    try {
      await uninstallPlugin(id);
      await get().load();
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },
}));

/**
 * The host registry derived from the *enabled* plugins. Later waves
 * (T18/T11/T15/T14) read their category off this seam instead of touching
 * plugin internals.
 */
export function selectRegistry(s: PluginsState): HostRegistry {
  return buildRegistry(s.plugins);
}
