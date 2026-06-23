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
  type PluginContribution,
  type AudioContribution,
  type PluginDependency,
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

/** Open a native picker for a plugin `.zip`; resolves to its path or null. */
export function pickPluginZip(): Promise<string | null> {
  return invoke<string | null>("pick_plugin_zip");
}

/** Import (unzip + validate) a plugin from a `.zip`; returns its manifest. The
 * caller then checks dependencies and prompts a restart so the loader runs. */
export function importPlugin(zipPath: string): Promise<PluginManifest> {
  return invoke<PluginManifest>("import_plugin", { zipPath });
}

/** Restart the app (so the plugin loader re-runs after install/uninstall). */
export function restartApp(): Promise<void> {
  return invoke("restart");
}

// --- Pure manifest validation (unit-tested) ----------------------------------

/** Parse a manifest's `dependencies` field (tolerant: skips malformed rows). */
function parseDependencies(raw: unknown): PluginDependency[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: PluginDependency[] = [];
  for (const dep of raw) {
    if (typeof dep === "object" && dep !== null) {
      const d = dep as Record<string, unknown>;
      if (typeof d.id === "string" && d.id.trim() !== "") {
        out.push({
          id: d.id,
          minVersion:
            typeof d.minVersion === "string" ? d.minVersion : undefined,
        });
      }
    }
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Validate an untrusted manifest object. Pure, no IO — mirrors the Rust
 * `validate_manifest`. Returns the typed manifest or throws with a reason.
 * Rejects blank required fields and mismatched apiVersion. `category` is a
 * free-form display label (behaviour comes from the plugin's code, not its
 * category), so it is no longer constrained to a fixed set.
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
  if (m.apiVersion !== PLUGIN_API_VERSION) {
    throw new Error(
      `plugin targets apiVersion ${String(m.apiVersion)} but host implements ${PLUGIN_API_VERSION}`,
    );
  }
  const permissions = Array.isArray(m.permissions)
    ? m.permissions.filter((p): p is string => typeof p === "string")
    : undefined;
  return {
    id,
    name,
    version,
    category,
    apiVersion: PLUGIN_API_VERSION,
    description: typeof m.description === "string" ? m.description : undefined,
    author: typeof m.author === "string" ? m.author : undefined,
    enabledByDefault: m.enabledByDefault === true,
    entry:
      typeof m.entry === "string" && m.entry.trim() !== "" ? m.entry : undefined,
    permissions: permissions && permissions.length > 0 ? permissions : undefined,
    dependencies: parseDependencies(m.dependencies),
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
