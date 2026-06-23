// Live registry of what runtime plugins have contributed (UI slots, fenced-code
// renderers, LLM hooks). Populated by `pluginHost.contextFor` as each plugin's
// `activate(ctx)` runs; read reactively by host components (PluginSlot,
// CodeBlock) and imperatively by the chat send path (llm hooks).
//
// Referential stability (the lesson from `selectRegistry`): selectors read
// stable slices — `set` does immutable updates that leave untouched slices by
// reference, and slot reads fall back to a shared EMPTY array — so a
// `useContributions(s => s.uiSlots[name] ?? EMPTY_UI)` selector doesn't churn.

import { create } from "zustand";
import type { Mount, RendererMount, LlmHook } from "@/types/pluginApi";

export interface UiItem {
  pluginId: string;
  mount: Mount;
}
export interface RendererItem {
  pluginId: string;
  language: string;
  mount: RendererMount;
}
export interface LlmHookItem {
  pluginId: string;
  hook: LlmHook;
}

/** Shared empty array for slot selectors with no contributions. */
export const EMPTY_UI: readonly UiItem[] = Object.freeze([]);

interface ContribState {
  /** Keyed by lowercased fenced-code language. */
  renderers: Record<string, RendererItem>;
  /** Keyed by UI slot name. */
  uiSlots: Record<string, UiItem[]>;
  llmHooks: LlmHookItem[];

  addRenderer(pluginId: string, language: string, mount: RendererMount): void;
  addUi(pluginId: string, slot: string, mount: Mount): void;
  addLlmHook(pluginId: string, hook: LlmHook): void;
  /** Remove every contribution registered by a plugin (disable/unload). */
  removeByPlugin(pluginId: string): void;
}

/** Drop entries owned by `pluginId` from a `Record<string, Item[]>`, dropping
 * now-empty keys so empty slots fall back to the shared EMPTY array. */
function pruneRecord<T extends { pluginId: string }>(
  rec: Record<string, T[]>,
  pluginId: string,
): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const [k, list] of Object.entries(rec)) {
    const kept = list.filter((it) => it.pluginId !== pluginId);
    if (kept.length > 0) out[k] = kept;
  }
  return out;
}

export const useContributions = create<ContribState>((set) => ({
  renderers: {},
  uiSlots: {},
  llmHooks: [],

  addRenderer: (pluginId, language, mount) =>
    set((s) => {
      const lang = language.toLowerCase();
      return {
        renderers: {
          ...s.renderers,
          [lang]: { pluginId, language: lang, mount },
        },
      };
    }),

  addUi: (pluginId, slot, mount) =>
    set((s) => ({
      uiSlots: {
        ...s.uiSlots,
        [slot]: [...(s.uiSlots[slot] ?? []), { pluginId, mount }],
      },
    })),

  addLlmHook: (pluginId, hook) =>
    set((s) => ({ llmHooks: [...s.llmHooks, { pluginId, hook }] })),

  removeByPlugin: (pluginId) =>
    set((s) => ({
      renderers: Object.fromEntries(
        Object.entries(s.renderers).filter(([, v]) => v.pluginId !== pluginId),
      ),
      uiSlots: pruneRecord(s.uiSlots, pluginId),
      llmHooks: s.llmHooks.filter((h) => h.pluginId !== pluginId),
    })),
}));
