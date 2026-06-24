import { create } from "zustand";
import {
  addModel,
  deleteModel,
  getCustomProviders,
  setCustomProviders,
  type CustomProvider,
} from "@/lib/db";
import { KNOWN_PROVIDER_IDS } from "@/lib/providers";
import { useModels } from "@/store/models";

// User-added OpenAI-compatible providers (endpoint + optional key), stored in the
// `settings` table. Mirrors `useModels` — the host registry / Rust dispatch are
// untouched: a custom provider just rides the shared OpenAI engine against its
// base URL (see `providers::stream` catch-all + `chatStream`).
//
// Note: this store deliberately does NOT touch `useKeys` (the API-key presence
// store). `useKeys` reads `KNOWN_PROVIDER_IDS` at module-init, so importing it
// here would form an init-time import cycle (lib/providers → this →
// store/keys → lib/providers). Key + presence are handled by the settings
// component instead, which is a leaf in the import graph.

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Slugify a label into a provider id, avoiding collisions with a built-in or an
 * existing custom id (suffixing -2, -3, … as needed). */
function makeId(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "provider";
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

interface CustomProvidersState {
  providers: CustomProvider[];
  loaded: boolean;
  error: string | null;

  /** Load (or reload) the custom providers from the db. */
  load: () => Promise<void>;
  /** Add a provider (id derived from the label) and seed its default model.
   * Returns the created provider so the caller can store its key, or null on
   * error. */
  add: (input: {
    label: string;
    baseUrl: string;
    defaultModel: string;
  }) => Promise<CustomProvider | null>;
  /** Remove a provider and its seeded models (the caller drops the stored key). */
  remove: (id: string) => Promise<void>;
}

export const useCustomProviders = create<CustomProvidersState>((set, get) => ({
  providers: [],
  loaded: false,
  error: null,

  load: async () => {
    try {
      const providers = await getCustomProviders();
      set({ providers, loaded: true, error: null });
    } catch (e) {
      set({ error: errMsg(e), loaded: true });
    }
  },

  add: async ({ label, baseUrl, defaultModel }) => {
    try {
      const existing = get().providers;
      const taken = new Set<string>([
        ...(KNOWN_PROVIDER_IDS as readonly string[]),
        ...existing.map((p) => p.id),
      ]);
      const id = makeId(label || baseUrl, taken);
      const provider: CustomProvider = {
        id,
        label: label.trim() || id,
        baseUrl: baseUrl.trim().replace(/\/+$/, ""),
        defaultModel: defaultModel.trim(),
      };
      const next = [...existing, provider];
      await setCustomProviders(next);
      // Seed one selectable model so the provider works immediately in the picker.
      if (provider.defaultModel) {
        await addModel({
          provider: id,
          modelId: provider.defaultModel,
          label: provider.defaultModel,
        });
        await useModels.getState().load();
      }
      set({ providers: next });
      return provider;
    } catch (e) {
      set({ error: errMsg(e) });
      return null;
    }
  },

  remove: async (id) => {
    try {
      const next = get().providers.filter((p) => p.id !== id);
      await setCustomProviders(next);
      // Drop this provider's seeded models so a later re-add stays clean.
      const models = useModels
        .getState()
        .models.filter((m) => m.provider === id);
      for (const m of models) await deleteModel(m.id);
      if (models.length) await useModels.getState().load();
      set({ providers: next });
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },
}));
