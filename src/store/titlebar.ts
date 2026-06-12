import { create } from "zustand";
import {
  getStoredControlsSide,
  getStoredControlsStyle,
  getStoredMenuBarMode,
  getStoredTitleBarMode,
  storeControlsSide,
  storeControlsStyle,
  storeMenuBarMode,
  storeTitleBarMode,
  type ControlsSide,
  type ControlsStyle,
  type MenuBarMode,
  type TitleBarMode,
} from "@/lib/titlebar";

interface TitleBarState {
  /** Native OS title bar or the app's custom compact one. */
  mode: TitleBarMode;
  /** Side of the custom bar the window controls sit on. */
  side: ControlsSide;
  /** Visual style of the custom window controls. */
  style: ControlsStyle;
  /** Application-menu placement: native widget, in-app bar, or hidden. */
  menuBar: MenuBarMode;

  setMode: (mode: TitleBarMode) => void;
  setSide: (side: ControlsSide) => void;
  setStyle: (style: ControlsStyle) => void;
  setMenuBar: (mode: MenuBarMode) => void;
}

// Seeded synchronously from localStorage (like `useTheme`/`useLayout`) so the
// bar renders in its saved configuration on first paint. Switching `mode` is
// observed by an effect in `App`, which toggles the OS decorations on the main
// window.
export const useTitleBar = create<TitleBarState>((set) => ({
  mode: getStoredTitleBarMode(),
  side: getStoredControlsSide(),
  style: getStoredControlsStyle(),
  menuBar: getStoredMenuBarMode(),

  setMode: (mode) => {
    storeTitleBarMode(mode);
    set({ mode });
  },

  setSide: (side) => {
    storeControlsSide(side);
    set({ side });
  },

  setStyle: (style) => {
    storeControlsStyle(style);
    set({ style });
  },

  setMenuBar: (menuBar) => {
    storeMenuBarMode(menuBar);
    set({ menuBar });
  },
}));
