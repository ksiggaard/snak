import { create } from "zustand";
import {
  ensureArtifact as dbEnsureArtifact,
  updateArtifactFiles as dbUpdateArtifactFiles,
} from "@/lib/db";
import type { Artifact, ArtifactFile } from "@/types/db";

interface ArtifactsState {
  /** Persisted artifacts, keyed by id. The inline card and the viewer both read
   * from here so an edit in the viewer is reflected in the card preview. */
  byId: Record<string, Artifact>;

  /**
   * Resolve the artifact for a `(message_id, ordinal)` slot, creating it from
   * the freshly-parsed block on first call. Returns the stored record (with any
   * in-app edits). Cached so repeated card renders don't re-hit the DB.
   */
  ensure: (input: {
    thread_id: string;
    message_id: string;
    ordinal: number;
    title: string;
    files: ArtifactFile[];
  }) => Promise<Artifact>;

  /** Persist edited files (optimistic in-memory update + DB write). */
  update: (id: string, files: ArtifactFile[]) => Promise<void>;
}

export const useArtifacts = create<ArtifactsState>((set, get) => ({
  byId: {},

  ensure: async (input) => {
    const slotMatch = Object.values(get().byId).find(
      (a) => a.message_id === input.message_id && a.ordinal === input.ordinal,
    );
    if (slotMatch) return slotMatch;
    const artifact = await dbEnsureArtifact(input);
    set((s) => ({ byId: { ...s.byId, [artifact.id]: artifact } }));
    return artifact;
  },

  update: async (id, files) => {
    const current = get().byId[id];
    if (current) {
      set((s) => ({
        byId: { ...s.byId, [id]: { ...current, files } },
      }));
    }
    await dbUpdateArtifactFiles(id, files);
  },
}));
