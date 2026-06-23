// The host side of the plugin API: builds a per-plugin `PluginContext` (gated by
// the manifest's declared permissions) and tears a plugin down on disable.
//
// Permissions are advisory (the trust model is unsandboxed): the host simply
// declines to populate, and warns about, capabilities a plugin didn't declare —
// it can't actually stop trusted JS from reaching globals. See pluginApi.ts.

import { useContributions } from "@/store/contributions";
import { pluginStorage } from "@/lib/pluginStorage";
import type { PluginContext, UiApi, LlmApi } from "@/types/pluginApi";
import type { PluginManifest } from "@/types/plugins";

/** onDisable handlers registered by each plugin, by plugin id. */
const onDisableHandlers = new Map<string, Array<() => void>>();

export function contextFor(manifest: PluginManifest): PluginContext {
  const id = manifest.id;
  const perms = new Set(manifest.permissions ?? []);
  const contrib = useContributions.getState();

  const need = (perm: string): boolean => {
    if (perms.has(perm)) return true;
    console.warn(
      `[plugin ${id}] tried to use "${perm}" without declaring that permission — ignored`,
    );
    return false;
  };

  const ui: UiApi = {
    registerRenderer: (language, mount) => {
      if (need("ui")) contrib.addRenderer(id, language, mount);
    },
    registerUi: (slot, mount) => {
      if (need("ui")) contrib.addUi(id, slot, mount);
    },
  };

  const llm: LlmApi | undefined = perms.has("llm-hook")
    ? { registerHook: (hook) => contrib.addLlmHook(id, hook) }
    : undefined;

  return {
    manifest,
    ui,
    storage: perms.has("storage") ? pluginStorage(id) : undefined,
    // `net` is a marker for the declared intent; fetch is globally reachable
    // anyway, so this can't restrict — it just documents + binds it.
    net: perms.has("network") ? ((...args) => fetch(...args)) : undefined,
    llm,
    onDisable: (fn) => {
      const list = onDisableHandlers.get(id) ?? [];
      list.push(fn);
      onDisableHandlers.set(id, list);
    },
  };
}

/** Run a plugin's onDisable handlers and drop all its contributions. Called on
 * live-disable and before a reload. Safe to call for an unloaded plugin. */
export function teardownPlugin(id: string): void {
  for (const fn of onDisableHandlers.get(id) ?? []) {
    try {
      fn();
    } catch (e) {
      console.error(`[plugin ${id}] onDisable handler threw`, e);
    }
  }
  onDisableHandlers.delete(id);
  useContributions.getState().removeByPlugin(id);
}
