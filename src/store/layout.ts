import { create } from "zustand";
import {
  clampSidebarWidth,
  getStoredSidebarMode,
  getStoredSidebarOpen,
  getStoredSidebarWidth,
  storeSidebarMode,
  storeSidebarOpen,
  storeSidebarWidth,
  tierForWidth,
  initialCompactNav,
  RAIL_BREAKPOINT,
  type SidebarMode,
  type LayoutTier,
} from "@/lib/layout";

interface LayoutState {
  /** Whether the sidebar is shown (inline at >= md; as a Sheet below md). */
  sidebarOpen: boolean;
  /** Persisted sidebar width in px (applied inline; clamped to MIN..MAX). */
  sidebarWidth: number;
  /** Which list the sidebar shows: chats or projects (T24). */
  sidebarMode: SidebarMode;
  /** Current responsive tier (wide / tablet / phone). */
  tier: LayoutTier;
  /** Narrow-width disclosure: 0 = chat only, 1 = pane, 2 = pane + rail.
   *  Ephemeral (not persisted); reset when entering a compact tier. */
  compactNav: 0 | 1 | 2;

  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (px: number) => void;
  setSidebarMode: (mode: SidebarMode) => void;
  setTier: (tier: LayoutTier) => void;
  cycleCompactNav: () => void;
  setCompactNav: (n: 0 | 1 | 2) => void;
}

// State is seeded synchronously from localStorage (like `useTheme`) so the
// sidebar renders at its saved width/mode on first paint with no flash.
export const useLayout = create<LayoutState>((set, get) => {
  const initialTier = tierForWidth(
    typeof window === "undefined" ? RAIL_BREAKPOINT : window.innerWidth,
  );
  return {
    sidebarOpen: getStoredSidebarOpen(),
    sidebarWidth: getStoredSidebarWidth(),
    sidebarMode: getStoredSidebarMode(),
    tier: initialTier,
    compactNav: initialCompactNav(initialTier),

    setSidebarOpen: (open) => {
      storeSidebarOpen(open);
      set({ sidebarOpen: open });
    },

    toggleSidebar: () => {
      if (get().tier === "wide") {
        const open = !get().sidebarOpen;
        storeSidebarOpen(open);
        set({ sidebarOpen: open });
      } else {
        // Compact: the 3-step cycle (chat → pane → pane+rail → chat).
        set({ compactNav: ((get().compactNav + 1) % 3) as 0 | 1 | 2 });
      }
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

    setTier: (tier) => {
      const prev = get().tier;
      // Entering a compact tier from wide: seed the disclosure default.
      if (prev === "wide" && tier !== "wide") {
        set({ tier, compactNav: initialCompactNav(tier) });
      } else {
        set({ tier });
      }
    },

    cycleCompactNav: () =>
      set({ compactNav: ((get().compactNav + 1) % 3) as 0 | 1 | 2 }),

    setCompactNav: (n) => set({ compactNav: n }),
  };
});
