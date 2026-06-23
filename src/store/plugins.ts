import { create } from "zustand";
import {
  buildRegistry,
  importPlugin,
  listPlugins,
  setPluginEnabled,
  uninstallPlugin,
  type HostRegistry,
} from "@/lib/plugins";
import { isRuntimePlugin, type PluginInfo, type PluginManifest } from "@/types/plugins";
import { deactivatePlugin } from "@/lib/pluginLoader";

interface PluginsState {
  plugins: PluginInfo[];
  loaded: boolean;
  error: string | null;
  /** A runtime plugin was enabled/imported but not yet loaded — the UI offers a
   * restart so the loader runs (in dependency order). */
  needsRestart: boolean;

  /** Load (or reload) the installed plugins from the backend. */
  load: () => Promise<void>;
  /** Enable/disable a plugin (persisted backend-side), then refresh. Disabling a
   * runtime plugin tears it down live; enabling one flags a restart. */
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  /** Uninstall a plugin (live-teardown + remove its folder), then refresh. */
  uninstall: (id: string) => Promise<void>;
  /** Import a plugin from a `.zip`; returns its manifest and flags a restart. */
  importFromZip: (zipPath: string) => Promise<PluginManifest>;
  clearRestart: () => void;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const usePlugins = create<PluginsState>((set, get) => ({
  plugins: [],
  loaded: false,
  error: null,
  needsRestart: false,

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
      const runtime = get().plugins.some(
        (p) => p.manifest.id === id && isRuntimePlugin(p.manifest),
      );
      await setPluginEnabled(id, enabled);
      await get().load();
      if (runtime) {
        // Disable tears down live; enable needs the loader to run (restart).
        if (!enabled) deactivatePlugin(id);
        else set({ needsRestart: true });
      }
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  uninstall: async (id) => {
    try {
      deactivatePlugin(id); // remove its contributions immediately (no-op if not loaded)
      await uninstallPlugin(id);
      await get().load();
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  importFromZip: async (zipPath) => {
    const manifest = await importPlugin(zipPath);
    await get().load();
    set({ needsRestart: true });
    return manifest;
  },

  clearRestart: () => set({ needsRestart: false }),
}));

/**
 * The host registry derived from the *enabled* plugins. Later waves
 * (T18/T11/T15/T14) read their category off this seam instead of touching
 * plugin internals.
 *
 * Memoized on the `plugins` array identity: this runs as a Zustand selector on
 * every render, and `useSyncExternalStore` compares snapshots with `Object.is`.
 * Returning a fresh object each call would make the snapshot look changed every
 * render → infinite re-render ("Maximum update depth exceeded"). The `plugins`
 * reference only changes when `load()` replaces it, so caching on it keeps the
 * registry (and its category arrays) referentially stable across renders.
 */
let cachedPlugins: PluginInfo[] | null = null;
let cachedRegistry: HostRegistry | null = null;

export function selectRegistry(s: PluginsState): HostRegistry {
  if (cachedRegistry === null || s.plugins !== cachedPlugins) {
    cachedPlugins = s.plugins;
    cachedRegistry = buildRegistry(s.plugins);
  }
  return cachedRegistry;
}
