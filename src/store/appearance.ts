import { create } from "zustand";
import {
  applyCustomColors,
  applyCustomTypography,
  getStoredChatListStyle,
  getStoredChatStyle,
  getStoredCustomColors,
  getStoredTypography,
  isHexColor,
  storeChatListStyle,
  storeChatStyle,
  storeCustomColors,
  storeTypography,
  type ChatListStyle,
  type ChatStyle,
  type ColorKey,
  type ColorMode,
  type CustomColors,
  type TypographyPrefs,
} from "@/lib/appearance";

interface AppearanceState {
  /** Per-mode custom accent/background picks (T30); empty = theme defaults. */
  colors: CustomColors;
  /** Custom font families/sizes for UI and chat (T33); null = defaults. */
  typography: TypographyPrefs;
  /** How chat messages render (T34): default/bubbles/compact/document. */
  chatStyle: ChatStyle;
  /** What a sidebar thread row shows (T35): title/date/detailed/preview. */
  chatListStyle: ChatListStyle;

  /** Set one color pick for one mode, persist, and re-apply the overrides. */
  setColor: (mode: ColorMode, key: ColorKey, hex: string) => void;
  /** Clear one color pick for one mode (back to the theme's value). */
  resetColor: (mode: ColorMode, key: ColorKey) => void;
  /** Merge a partial typography update (null fields reset to default). */
  setTypography: (patch: Partial<TypographyPrefs>) => void;
  /** Switch the chat message layout style (T34). */
  setChatStyle: (style: ChatStyle) => void;
  /** Switch the sidebar chat-list row style (T35). */
  setChatListStyle: (style: ChatListStyle) => void;
}

export const useAppearance = create<AppearanceState>((set, get) => ({
  colors: getStoredCustomColors(),
  typography: getStoredTypography(),
  chatStyle: getStoredChatStyle(),
  chatListStyle: getStoredChatListStyle(),

  setColor: (mode, key, hex) => {
    if (!isHexColor(hex)) return;
    const cur = get().colors;
    const colors: CustomColors = {
      ...cur,
      [mode]: { ...cur[mode], [key]: hex.toLowerCase() },
    };
    storeCustomColors(colors);
    applyCustomColors(colors);
    set({ colors });
  },

  resetColor: (mode, key) => {
    const cur = get().colors;
    const modeColors = { ...cur[mode] };
    delete modeColors[key];
    const colors: CustomColors = { ...cur, [mode]: modeColors };
    storeCustomColors(colors);
    applyCustomColors(colors);
    set({ colors });
  },

  setTypography: (patch) => {
    const typography: TypographyPrefs = { ...get().typography, ...patch };
    storeTypography(typography);
    applyCustomTypography(typography);
    set({ typography });
  },

  setChatStyle: (style) => {
    storeChatStyle(style);
    set({ chatStyle: style });
  },

  setChatListStyle: (style) => {
    storeChatListStyle(style);
    set({ chatListStyle: style });
  },
}));

// Apply the stored overrides as soon as this module loads (before first
// paint), mirroring the light/dark bootstrap in `store/theme.ts`. The custom
// CSS wins over installed-theme CSS by selector specificity, so the apply
// order relative to the async theme load doesn't matter.
applyCustomColors(getStoredCustomColors());
applyCustomTypography(getStoredTypography());
