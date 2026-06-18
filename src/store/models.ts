import { create } from "zustand";
import { addModel, deleteModel, listModels, updateModelNotes } from "@/lib/db";
import type { Model, Provider } from "@/types/db";

interface ModelsState {
  models: Model[];
  loaded: boolean;
  error: string | null;

  /** Load (or reload) the configured models from the db. */
  load: () => Promise<void>;
  /** Add a model for a provider, then reload. */
  add: (provider: Provider, modelId: string, label: string, notes?: string) => Promise<void>;
  /** Delete a model by id, then reload. */
  remove: (id: number) => Promise<void>;
  /** Update the notes field for a model, then reload. */
  updateNotes: (id: number, notes: string) => Promise<void>;
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

  add: async (provider, modelId, label, notes) => {
    try {
      await addModel({ provider, modelId, label, notes });
      await get().load();
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  updateNotes: async (id, notes) => {
    try {
      await updateModelNotes(id, notes);
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
