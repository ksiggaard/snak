// Plugin system types (T12 foundation). Mirrors `PluginManifest` / `PluginInfo`
// in src-tauri/src/plugins/mod.rs. These are the contracts later waves target:
// T18 (providers-as-plugins), T11 (themes), T15 (skills), T14 (slash-commands).

/** Host API version this build implements. Manifests must target this. */
export const PLUGIN_API_VERSION = 1;

export type PluginCategory =
  | "provider"
  | "theme"
  | "skill"
  | "slash-command"
  | "renderer";

export const PLUGIN_CATEGORIES: PluginCategory[] = [
  "provider",
  "theme",
  "skill",
  "slash-command",
  "renderer",
];

/** Human labels for each category (used in the settings UI grouping). */
export const CATEGORY_LABELS: Record<PluginCategory, string> = {
  provider: "Providers",
  theme: "Themes",
  skill: "Skills",
  "slash-command": "Slash commands",
  renderer: "Renderers",
};

// --- Category-specific contribution descriptors (extension points) ----------
// This wave only stores/round-trips these; full wiring is later waves.

/** "Add LLM X support". Shape-compatible with `ProviderMeta` (src/lib/providers.ts). */
export interface ProviderContribution {
  id: string;
  label: string;
  defaultModel: string;
  keyHint: string;
}

/** A theme: CSS overriding the documented variables in src/index.css. */
export interface ThemeContribution {
  name: string;
  /** CSS text, or an app-data file path (resolved by the theme loader, T11). */
  css: string;
}

/** Packaged instructions surfaced to the model (T15). */
export interface SkillContribution {
  name: string;
  instructions: string;
}

/** A `/command` descriptor handled in the composer (T14). */
export interface SlashCommandContribution {
  command: string;
  description: string;
}

/** A fenced-code-block renderer for one language (T42). Per the T12
 * declarative security model the descriptor only *names* the language —
 * the renderer itself is built-in code keyed by it (e.g. "mermaid"). */
export interface RendererContribution {
  language: string;
}

export type PluginContribution =
  | ProviderContribution
  | ThemeContribution
  | SkillContribution
  | SlashCommandContribution
  | RendererContribution;

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  category: PluginCategory;
  apiVersion: number;
  description?: string;
  author?: string;
  enabledByDefault?: boolean;
  /** Category-specific descriptor; interpreted by later waves. */
  contributes?: PluginContribution;
}

export type PluginSource = "builtin" | "user";

/** A discovered plugin with its source and resolved enabled state. */
export interface PluginInfo {
  manifest: PluginManifest;
  source: PluginSource;
  enabled: boolean;
}
