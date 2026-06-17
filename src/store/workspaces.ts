import { create } from "zustand";
import {
  addWorkspaceFile,
  addWorkspaceMemory,
  createWorkspace,
  deleteWorkspace,
  deleteWorkspaceFile,
  deleteWorkspaceMemory,
  listWorkspaceFiles,
  listWorkspaceMemory,
  listWorkspaces,
  renameWorkspace,
  setWorkspaceImages,
  setWorkspaceInstructions,
  setWorkspaceMemoryEnabled,
  setWorkspaceQuickActions,
  updateWorkspaceMemory,
} from "@/lib/db";
import { useThreads } from "@/store/threads";
import type { Workspace, WorkspaceFile, WorkspaceMemory } from "@/types/db";

interface WorkspacesState {
  workspaces: Workspace[];
  /** Workspace whose detail view is open in the main pane, or null. */
  openWorkspaceId: string | null;
  /** Files for the currently open workspace. */
  openWorkspaceFiles: WorkspaceFile[];
  /** Memory entries for the currently open workspace. */
  openWorkspaceMemory: WorkspaceMemory[];
  /** Which sub-view is shown for the open workspace (T63). */
  openWorkspaceView: "dashboard" | "settings";
  initialized: boolean;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  create: () => Promise<Workspace>;
  rename: (id: string, name: string) => Promise<void>;
  setInstructions: (id: string, instructions: string) => Promise<void>;
  /** Persist a workspace's quick-actions override JSON (empty = use global). */
  setQuickActions: (id: string, quickActions: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Open a workspace's detail view (loads its files and memory). */
  open: (id: string) => Promise<void>;
  /** Close the workspace detail view. */
  close: () => void;
  /** Switch between dashboard and settings sub-views (T63). */
  setWorkspaceView: (view: "dashboard" | "settings") => void;
  /** Update the profile and/or cover image for a workspace (T63). */
  setImages: (
    id: string,
    profileImage: string | null,
    coverImage: string | null,
  ) => Promise<void>;
  addFile: (
    workspaceId: string,
    name: string,
    content: string,
    sourceUrl?: string | null,
  ) => Promise<void>;
  removeFile: (fileId: string) => Promise<void>;
  /** Add a memory entry to the open workspace. */
  addMemory: (workspaceId: string, content: string) => Promise<void>;
  /** Update a memory entry in place (content change). */
  updateMemory: (id: string, content: string) => Promise<void>;
  /** Remove a memory entry from the open workspace. */
  removeMemory: (id: string) => Promise<void>;
  /** Toggle the memory_enabled flag for a workspace. */
  setMemoryEnabled: (id: string, enabled: boolean) => Promise<void>;
}

export const useWorkspaces = create<WorkspacesState>((set, get) => ({
  workspaces: [],
  openWorkspaceId: null,
  openWorkspaceFiles: [],
  openWorkspaceMemory: [],
  openWorkspaceView: "dashboard",
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    set({ workspaces: await listWorkspaces(), initialized: true });
  },

  refresh: async () => {
    set({ workspaces: await listWorkspaces() });
  },

  create: async () => {
    const workspace = await createWorkspace({});
    await get().refresh();
    return workspace;
  },

  rename: async (id, name) => {
    await renameWorkspace(id, name.trim() || "Untitled workspace");
    await get().refresh();
  },

  setInstructions: async (id, instructions) => {
    await setWorkspaceInstructions(id, instructions);
    await get().refresh();
  },

  setQuickActions: async (id, quickActions) => {
    await setWorkspaceQuickActions(id, quickActions);
    await get().refresh();
  },

  remove: async (id) => {
    await deleteWorkspace(id);
    if (get().openWorkspaceId === id) {
      set({ openWorkspaceId: null, openWorkspaceFiles: [], openWorkspaceMemory: [] });
    }
    await get().refresh();
    // Threads were orphaned to no-workspace — reflect that in the thread list.
    await useThreads.getState().refreshThreads();
  },

  open: async (id) => {
    const [files, memory] = await Promise.all([
      listWorkspaceFiles(id),
      listWorkspaceMemory(id),
    ]);
    set({
      openWorkspaceId: id,
      openWorkspaceFiles: files,
      openWorkspaceMemory: memory,
      openWorkspaceView: "dashboard",
    });
  },

  close: () => {
    set({
      openWorkspaceId: null,
      openWorkspaceFiles: [],
      openWorkspaceMemory: [],
      openWorkspaceView: "dashboard",
    });
  },

  setWorkspaceView: (view) => set({ openWorkspaceView: view }),

  setImages: async (id, profileImage, coverImage) => {
    await setWorkspaceImages(id, profileImage, coverImage);
    await get().refresh();
  },

  addFile: async (workspaceId, name, content, sourceUrl) => {
    await addWorkspaceFile({
      workspace_id: workspaceId,
      name,
      content,
      source_url: sourceUrl ?? null,
    });
    if (get().openWorkspaceId === workspaceId) {
      set({ openWorkspaceFiles: await listWorkspaceFiles(workspaceId) });
    }
    await get().refresh();
  },

  removeFile: async (fileId) => {
    await deleteWorkspaceFile(fileId);
    const openId = get().openWorkspaceId;
    if (openId) {
      set({ openWorkspaceFiles: await listWorkspaceFiles(openId) });
    }
  },

  addMemory: async (workspaceId, content) => {
    await addWorkspaceMemory(workspaceId, content);
    if (get().openWorkspaceId === workspaceId) {
      set({ openWorkspaceMemory: await listWorkspaceMemory(workspaceId) });
    }
  },

  updateMemory: async (id, content) => {
    await updateWorkspaceMemory(id, content);
    const openId = get().openWorkspaceId;
    if (openId) {
      set({ openWorkspaceMemory: await listWorkspaceMemory(openId) });
    }
  },

  removeMemory: async (id) => {
    await deleteWorkspaceMemory(id);
    const openId = get().openWorkspaceId;
    if (openId) {
      set({ openWorkspaceMemory: await listWorkspaceMemory(openId) });
    }
  },

  setMemoryEnabled: async (id, enabled) => {
    await setWorkspaceMemoryEnabled(id, enabled);
    await get().refresh();
  },
}));
