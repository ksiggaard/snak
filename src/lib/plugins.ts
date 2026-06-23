// Frontend plugin API (T12 foundation): command wrappers, manifest validation,
// and the host registry stub later waves register against.
//
// Discovery + enabled-state are owned by Rust (filesystem / app-data); this
// module is the typed bridge plus pure validation. The `HostRegistry` exposes
// the enabled contributions per category so consumers depend on the registry,
// not on plugin internals — full wiring (e.g. feeding providers into
// providers.ts) is T18/T11/T15/T14.

import { invoke } from "@tauri-apps/api/core";
import {
  PLUGIN_API_VERSION,
  PLUGIN_CATEGORIES,
  type PluginCategory,
  type PluginContribution,
  type AudioContribution,
  type PluginInfo,
  type PluginManifest,
  type ProviderContribution,
  type RendererContribution,
  type SlashCommandContribution,
  type ThemeContribution,
} from "@/types/plugins";

// --- Tauri command wrappers --------------------------------------------------

export function listPlugins(): Promise<PluginInfo[]> {
  return invoke<PluginInfo[]>("list_plugins");
}

export function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  return invoke("set_plugin_enabled", { id, enabled });
}

export function uninstallPlugin(id: string): Promise<void> {
  return invoke("uninstall_plugin", { id });
}

// --- Pure manifest validation (unit-tested) ----------------------------------

/**
 * Validate an untrusted manifest object. Pure, no IO — mirrors the Rust
 * `validate_manifest`. Returns the typed manifest or throws with a reason.
 * Rejects unknown categories, blank required fields, and mismatched apiVersion.
 */
export function parseManifest(raw: unknown): PluginManifest {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("manifest must be an object");
  }
  const m = raw as Record<string, unknown>;
  const reqStr = (key: string): string => {
    const v = m[key];
    if (typeof v !== "string" || v.trim() === "") {
      throw new Error(`manifest \`${key}\` is required`);
    }
    return v;
  };
  const id = reqStr("id");
  const name = reqStr("name");
  const version = reqStr("version");
  const category = reqStr("category");
  if (!PLUGIN_CATEGORIES.includes(category as PluginCategory)) {
    throw new Error(
      `unknown plugin category \`${category}\` (expected one of ${PLUGIN_CATEGORIES.join(", ")})`,
    );
  }
  if (m.apiVersion !== PLUGIN_API_VERSION) {
    throw new Error(
      `plugin targets apiVersion ${String(m.apiVersion)} but host implements ${PLUGIN_API_VERSION}`,
    );
  }
  return {
    id,
    name,
    version,
    category: category as PluginCategory,
    apiVersion: PLUGIN_API_VERSION,
    description: typeof m.description === "string" ? m.description : undefined,
    author: typeof m.author === "string" ? m.author : undefined,
    enabledByDefault: m.enabledByDefault === true,
    contributes:
      typeof m.contributes === "object" && m.contributes !== null
        ? (m.contributes as PluginContribution)
        : undefined,
  };
}

// --- Host registry (extension-point stub) ------------------------------------

/**
 * Read-only view of the contributions of *enabled* plugins, grouped so each
 * later wave can consume just its category. This is the single seam consumers
 * (ModelPicker, theme loader, composer) depend on — they never read plugin
 * internals directly.
 */
export interface HostRegistry {
  providers: ProviderContribution[];
  themes: ThemeContribution[];
  slashCommands: SlashCommandContribution[];
  renderers: RendererContribution[];
  audio: AudioContribution[];
}

/** Build the registry from a plugin list (only `enabled` plugins contribute). */
export function buildRegistry(plugins: PluginInfo[]): HostRegistry {
  const reg: HostRegistry = {
    providers: [],
    themes: [],
    slashCommands: [],
    renderers: [],
    audio: [],
  };
  for (const p of plugins) {
    if (!p.enabled || !p.manifest.contributes) continue;
    const c = p.manifest.contributes;
    switch (p.manifest.category) {
      case "provider":
        reg.providers.push(c as ProviderContribution);
        break;
      case "theme":
        reg.themes.push(c as ThemeContribution);
        break;
      case "slash-command":
        reg.slashCommands.push(c as SlashCommandContribution);
        break;
      case "renderer":
        reg.renderers.push(c as RendererContribution);
        break;
      case "audio":
        reg.audio.push(c as AudioContribution);
        break;
    }
  }
  return reg;
}

/** True when an enabled `renderer` plugin contributes the given language
 * (case-insensitive), e.g. "mermaid". Consumed by `CodeBlock` to decide
 * whether to render a diagram instead of a plain fenced block. */
export function hasRenderer(reg: HostRegistry, language: string): boolean {
  const lang = language.toLowerCase();
  return reg.renderers.some((r) => r.language.toLowerCase() === lang);
}

/** True when the `audio` plugin (TTS/STT) is enabled. The gate the composer mic
 * button and the per-reply speak button read to decide whether to render. */
export function audioEnabled(reg: HostRegistry): boolean {
  return reg.audio.length > 0;
}
