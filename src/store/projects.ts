import { create } from "zustand";
import {
  addProjectFile,
  createProject,
  deleteProject,
  deleteProjectFile,
  listProjectFiles,
  listProjects,
  renameProject,
  setProjectInstructions,
  setProjectQuickActions,
} from "@/lib/db";
import { useThreads } from "@/store/threads";
import type { Project, ProjectFile } from "@/types/db";

interface ProjectsState {
  projects: Project[];
  /** Project whose detail view is open in the main pane, or null. */
  openProjectId: string | null;
  /** Files for the currently open project. */
  openProjectFiles: ProjectFile[];
  initialized: boolean;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  create: () => Promise<Project>;
  rename: (id: string, name: string) => Promise<void>;
  setInstructions: (id: string, instructions: string) => Promise<void>;
  /** Persist a project's quick-actions override JSON (empty = use global). */
  setQuickActions: (id: string, quickActions: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Open a project's detail view (loads its files). */
  open: (id: string) => Promise<void>;
  /** Close the project detail view. */
  close: () => void;
  addFile: (projectId: string, name: string, content: string) => Promise<void>;
  removeFile: (fileId: string) => Promise<void>;
}

export const useProjects = create<ProjectsState>((set, get) => ({
  projects: [],
  openProjectId: null,
  openProjectFiles: [],
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    set({ projects: await listProjects(), initialized: true });
  },

  refresh: async () => {
    set({ projects: await listProjects() });
  },

  create: async () => {
    const project = await createProject({});
    await get().refresh();
    return project;
  },

  rename: async (id, name) => {
    await renameProject(id, name.trim() || "Untitled project");
    await get().refresh();
  },

  setInstructions: async (id, instructions) => {
    await setProjectInstructions(id, instructions);
    await get().refresh();
  },

  setQuickActions: async (id, quickActions) => {
    await setProjectQuickActions(id, quickActions);
    await get().refresh();
  },

  remove: async (id) => {
    await deleteProject(id);
    if (get().openProjectId === id) {
      set({ openProjectId: null, openProjectFiles: [] });
    }
    await get().refresh();
    // Threads were orphaned to no-project — reflect that in the thread list.
    await useThreads.getState().refreshThreads();
  },

  open: async (id) => {
    const files = await listProjectFiles(id);
    set({ openProjectId: id, openProjectFiles: files });
  },

  close: () => {
    set({ openProjectId: null, openProjectFiles: [] });
  },

  addFile: async (projectId, name, content) => {
    await addProjectFile({ project_id: projectId, name, content });
    if (get().openProjectId === projectId) {
      set({ openProjectFiles: await listProjectFiles(projectId) });
    }
    await get().refresh();
  },

  removeFile: async (fileId) => {
    await deleteProjectFile(fileId);
    const openId = get().openProjectId;
    if (openId) {
      set({ openProjectFiles: await listProjectFiles(openId) });
    }
  },
}));
