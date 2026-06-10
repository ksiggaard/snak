import { create } from "zustand";
import {
  clampSidebarWidth,
  getStoredSidebarMode,
  getStoredSidebarOpen,
  getStoredSidebarWidth,
  storeSidebarMode,
  storeSidebarOpen,
  storeSidebarWidth,
  type SidebarMode,
} from "@/lib/layout";

interface LayoutState {
  /** Whether the sidebar is shown (inline at >= md; as a Sheet below md). */
  sidebarOpen: boolean;
  /** Persisted sidebar width in px (applied inline; clamped to MIN..MAX). */
  sidebarWidth: number;
  /** Which list the sidebar shows: chats or projects (T24). */
  sidebarMode: SidebarMode;

  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (px: number) => void;
  setSidebarMode: (mode: SidebarMode) => void;
}

// State is seeded synchronously from localStorage (like `useTheme`) so the
// sidebar renders at its saved width/mode on first paint with no flash.
export const useLayout = create<LayoutState>((set, get) => ({
  sidebarOpen: getStoredSidebarOpen(),
  sidebarWidth: getStoredSidebarWidth(),
  sidebarMode: getStoredSidebarMode(),

  setSidebarOpen: (open) => {
    storeSidebarOpen(open);
    set({ sidebarOpen: open });
  },

  toggleSidebar: () => {
    const open = !get().sidebarOpen;
    storeSidebarOpen(open);
    set({ sidebarOpen: open });
  },

  setSidebarWidth: (px) => {
    const width = clampSidebarWidth(px);
    storeSidebarWidth(width);
    set({ sidebarWidth: width });
  },

  setSidebarMode: (mode) => {
    storeSidebarMode(mode);
    set({ sidebarMode: mode });
  },
}));
