import { create } from "zustand";
import {
  addWorkspaceFile,
  createWorkspace,
  deleteWorkspace,
  deleteWorkspaceFile,
  listWorkspaceFiles,
  listWorkspaces,
  renameWorkspace,
  setWorkspaceInstructions,
  setWorkspaceQuickActions,
} from "@/lib/db";
import { useThreads } from "@/store/threads";
import type { Workspace, WorkspaceFile } from "@/types/db";

interface WorkspacesState {
  workspaces: Workspace[];
  /** Workspace whose detail view is open in the main pane, or null. */
  openWorkspaceId: string | null;
  /** Files for the currently open workspace. */
  openWorkspaceFiles: WorkspaceFile[];
  initialized: boolean;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  create: () => Promise<Workspace>;
  rename: (id: string, name: string) => Promise<void>;
  setInstructions: (id: string, instructions: string) => Promise<void>;
  /** Persist a workspace's quick-actions override JSON (empty = use global). */
  setQuickActions: (id: string, quickActions: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Open a workspace's detail view (loads its files). */
  open: (id: string) => Promise<void>;
  /** Close the workspace detail view. */
  close: () => void;
  addFile: (
    workspaceId: string,
    name: string,
    content: string,
  ) => Promise<void>;
  removeFile: (fileId: string) => Promise<void>;
}

export const useWorkspaces = create<WorkspacesState>((set, get) => ({
  workspaces: [],
  openWorkspaceId: null,
  openWorkspaceFiles: [],
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
      set({ openWorkspaceId: null, openWorkspaceFiles: [] });
    }
    await get().refresh();
    // Threads were orphaned to no-workspace — reflect that in the thread list.
    await useThreads.getState().refreshThreads();
  },

  open: async (id) => {
    const files = await listWorkspaceFiles(id);
    set({ openWorkspaceId: id, openWorkspaceFiles: files });
  },

  close: () => {
    set({ openWorkspaceId: null, openWorkspaceFiles: [] });
  },

  addFile: async (workspaceId, name, content) => {
    await addWorkspaceFile({ workspace_id: workspaceId, name, content });
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
}));
