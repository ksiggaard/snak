// Runtime plugin loader. Reads each enabled runtime plugin's compiled entry
// source from Rust, wraps it in a Blob URL, dynamic-`import()`s it (confirmed to
// work in the app's WebKit webview), and calls its `activate(ctx)` with a
// permission-gated context. Plugins load in dependency (topological) order; a
// single plugin failing is logged and skipped — it never breaks the app.
//
// `/* @vite-ignore */` on the import is MANDATORY: without it Rollup tries to
// resolve the runtime blob URL at build time and the build fails.

import { invoke } from "@tauri-apps/api/core";
import { listPlugins } from "@/lib/plugins";
import { isRuntimePlugin, type PluginInfo } from "@/types/plugins";
import { topoSort } from "@/lib/pluginDeps";
import { contextFor, teardownPlugin } from "@/lib/pluginHost";
import type { PluginModule } from "@/types/pluginApi";

/** Read a plugin's entry source, import it as an ESM blob, and activate it. */
async function loadOne(info: PluginInfo): Promise<void> {
  const src = await invoke<string>("read_plugin_entry", {
    id: info.manifest.id,
  });
  const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  try {
    const mod = (await import(/* @vite-ignore */ url)) as PluginModule;
    await mod.activate?.(contextFor(info.manifest));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Order enabled runtime plugins so dependencies activate first. Falls back to
 * the original order if a cycle is detected (logged). */
function inDependencyOrder(runtime: PluginInfo[]): PluginInfo[] {
  const byId = new Map(runtime.map((p) => [p.manifest.id, p]));
  try {
    return topoSort(runtime.map((p) => p.manifest))
      .map((m) => byId.get(m.id))
      .filter((p): p is PluginInfo => p !== undefined);
  } catch (e) {
    console.error("[plugins] dependency cycle — loading in listed order", e);
    return runtime;
  }
}

/** Load + activate every enabled runtime plugin. Call once, after the app
 * mounts, in the main window only. */
export async function loadEnabledPlugins(): Promise<void> {
  let plugins: PluginInfo[];
  try {
    plugins = await listPlugins();
  } catch (e) {
    console.error("[plugins] could not list plugins", e);
    return;
  }
  const runtime = plugins.filter((p) => p.enabled && isRuntimePlugin(p.manifest));
  for (const info of inDependencyOrder(runtime)) {
    try {
      await loadOne(info);
    } catch (e) {
      console.error(`[plugin ${info.manifest.id}] failed to load`, e);
    }
  }
}

/** Live-deactivate one runtime plugin: run its onDisable cleanups and drop its
 * contributions (used on disable/uninstall — instant, no restart). Enabling,
 * by contrast, restarts so plugins load in dependency order. */
export function deactivatePlugin(id: string): void {
  teardownPlugin(id);
}
