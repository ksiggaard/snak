import { create } from "zustand";
import {
  deleteSkill,
  importSkills,
  listSkills,
  saveSkill,
  setSkillEnabled,
  type SkillMeta,
} from "@/lib/skills";

interface SkillsState {
  skills: SkillMeta[];
  loaded: boolean;
  error: string | null;

  /** Load (or reload) the discovered skills from the backend. */
  list: () => Promise<void>;
  /** Enable/disable a skill (persisted backend-side), then refresh. */
  setEnabled: (name: string, enabled: boolean) => Promise<void>;
  /** Create/update a skill, then refresh. Throws on failure (the form shows it). */
  save: (
    name: string,
    description: string,
    body: string,
    slug?: string,
  ) => Promise<void>;
  /** Delete a skill, then refresh. */
  remove: (name: string) => Promise<void>;
  /** Import skill folder(s) from a directory, then refresh; returns the count. */
  importFrom: (dir: string) => Promise<number>;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useSkills = create<SkillsState>((set, get) => ({
  skills: [],
  loaded: false,
  error: null,

  list: async () => {
    try {
      const skills = await listSkills();
      set({ skills, loaded: true, error: null });
    } catch (e) {
      set({ error: errMsg(e), loaded: true });
    }
  },

  setEnabled: async (name, enabled) => {
    try {
      await setSkillEnabled(name, enabled);
      await get().list();
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  save: async (name, description, body, slug) => {
    await saveSkill(name, description, body, slug);
    await get().list();
  },

  remove: async (name) => {
    try {
      await deleteSkill(name);
      await get().list();
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  importFrom: async (dir) => {
    const n = await importSkills(dir);
    await get().list();
    return n;
  },
}));
