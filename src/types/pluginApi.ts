// Author-facing plugin API — the SDK surface a runtime plugin codes against.
//
// A runtime plugin's compiled ESM entry module exports `activate(ctx)`. The host
// (pluginLoader) builds a per-plugin `PluginContext` and calls activate with it.
// Everything a plugin can do flows through `ctx` — there is no host global and
// no host-module imports — so a plugin is a single self-contained ESM file.
//
// Trust model: runtime plugins are unsandboxed, trusted JS. The `permissions`
// gating below is advisory ergonomics (the host only populates the parts of
// `ctx` a plugin declared) — NOT a security boundary.

import type { PluginManifest } from "@/types/plugins";

/** A mount returns an optional cleanup, run when the plugin is disabled or the
 * host element unmounts. Mounts get a plain DOM element — no shared React. */
export type PluginCleanup = void | (() => void);
export type Mount = (el: HTMLElement) => PluginCleanup;
/** A fenced-code renderer mount: gets the block's source text. */
export type RendererMount = (el: HTMLElement, code: string) => PluginCleanup;

/** Named UI insertion points the host exposes (see `PluginSlot`). The "settings"
 * slot renders inside the Plugins settings card — a plugin's own settings UI. */
export type UiSlot = "header" | "message-toolbar" | "sidebar" | "settings";

export interface UiApi {
  /** Render a fenced code block of `language` (e.g. "mermaid") as a custom view. */
  registerRenderer(language: string, mount: RendererMount): void;
  /** Add UI into a named slot — e.g. a header button or a settings panel. */
  registerUi(slot: UiSlot, mount: Mount): void;
}

/** Scoped key-value storage (gated by the "storage" permission). Backed by the
 * app's SQLite db, namespaced by plugin id. */
export interface KVStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** A message as seen by an llm hook (content present only if the plugin
 * declared "read-messages"; otherwise blanked). */
export interface HookMessage {
  role: string;
  content: string;
}

export interface LlmHook {
  /** Extra system-prompt text injected into every send. */
  systemPrompt?(): string | undefined;
  /** Transform the outgoing message list just before it is sent. */
  transformOutgoing?(messages: HookMessage[]): HookMessage[] | undefined;
  /** Observe the final assistant text once a response completes. */
  onResponse?(text: string): void;
}

export interface LlmApi {
  registerHook(hook: LlmHook): void;
}

export interface PluginContext {
  /** The plugin's own manifest (read-only). */
  manifest: Readonly<PluginManifest>;
  /** UI registration. Calls are no-ops (with a console warning) unless the
   * plugin declared the "ui" permission. */
  ui: UiApi;
  /** Scoped storage — present only if "storage" was declared. */
  storage?: KVStore;
  /** Network access (bound `fetch`) — present only if "network" was declared. */
  net?: typeof fetch;
  /** Call a Tauri command (present only if "commands" was declared). Broad host
   * access — only bundled/trusted plugins should declare it. */
  invoke?: <T = unknown>(
    command: string,
    args?: Record<string, unknown>,
  ) => Promise<T>;
  /** LLM hooks — present only if "llm-hook" was declared. */
  llm?: LlmApi;
  /** Register a cleanup to run when this plugin is disabled/unloaded. */
  onDisable(fn: () => void): void;
}

/** The shape a runtime plugin's entry module must export. */
export interface PluginModule {
  activate?(ctx: PluginContext): void | Promise<void>;
}
