import { create } from "zustand";
import {
  saveLibraryArtifact as dbSaveLibraryArtifact,
  listLibraryArtifacts as dbListLibraryArtifacts,
  updateLibraryArtifactFiles as dbUpdateLibraryArtifactFiles,
  deleteLibraryArtifact as dbDeleteLibraryArtifact,
  renameLibraryArtifact as dbRenameLibraryArtifact,
} from "@/lib/db";
import type { ArtifactFile, LibraryArtifact } from "@/types/db";

interface LibraryState {
  items: LibraryArtifact[];
  openId: string | null;
  load: () => Promise<void>;
  setOpenId: (id: string | null) => void;
  save: (title: string, files: ArtifactFile[]) => Promise<LibraryArtifact>;
  update: (id: string, files: ArtifactFile[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
}

export const useLibrary = create<LibraryState>((set, get) => ({
  items: [],
  openId: null,

  load: async () => {
    const items = await dbListLibraryArtifacts();
    set({ items });
  },

  setOpenId: (id) => set({ openId: id }),

  save: async (title, files) => {
    const item = await dbSaveLibraryArtifact(title, files);
    set((s) => ({ items: [item, ...s.items] }));
    return item;
  },

  update: async (id, files) => {
    const current = get().items.find((i) => i.id === id);
    if (current) {
      set((s) => ({
        items: s.items.map((i) =>
          i.id === id ? { ...i, files, updated_at: new Date().toISOString() } : i,
        ),
      }));
    }
    await dbUpdateLibraryArtifactFiles(id, files);
  },

  remove: async (id) => {
    set((s) => ({
      items: s.items.filter((i) => i.id !== id),
      openId: s.openId === id ? null : s.openId,
    }));
    await dbDeleteLibraryArtifact(id);
  },

  rename: async (id, title) => {
    set((s) => ({
      items: s.items.map((i) =>
        i.id === id ? { ...i, title, updated_at: new Date().toISOString() } : i,
      ),
    }));
    await dbRenameLibraryArtifact(id, title);
  },
}));
