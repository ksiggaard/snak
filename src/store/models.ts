import { create } from "zustand";
import { addModel, deleteModel, listModels } from "@/lib/db";
import type { Model, Provider } from "@/types/db";

interface ModelsState {
  models: Model[];
  loaded: boolean;
  error: string | null;

  /** Load (or reload) the configured models from the db. */
  load: () => Promise<void>;
  /** Add a model for a provider, then reload. */
  add: (provider: Provider, modelId: string, label: string) => Promise<void>;
  /** Delete a model by id, then reload. */
  remove: (id: number) => Promise<void>;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useModels = create<ModelsState>((set, get) => ({
  models: [],
  loaded: false,
  error: null,

  load: async () => {
    try {
      const models = await listModels();
      set({ models, loaded: true, error: null });
    } catch (e) {
      set({ error: errMsg(e), loaded: true });
    }
  },

  add: async (provider, modelId, label) => {
    try {
      await addModel({ provider, modelId, label });
      await get().load();
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  remove: async (id) => {
    try {
      await deleteModel(id);
      await get().load();
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },
}));
