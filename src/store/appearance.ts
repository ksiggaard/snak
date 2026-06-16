import { create } from "zustand";
import {
  applyAnimations,
  applyCustomColors,
  applyCustomRadius,
  applyCustomTypography,
  clampContrast,
  clampSize,
  getStoredAnimations,
  getStoredChatListStyle,
  getStoredChatMaxWidth,
  getStoredChatStyle,
  getStoredCustomColors,
  getStoredRadius,
  getStoredTypography,
  isHexColor,
  CHAT_WIDTH,
  RADIUS,
  storeChatListStyle,
  storeAnimations,
  storeChatMaxWidth,
  storeChatStyle,
  storeCustomColors,
  storeRadius,
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
  /** Corner radius (px) for the `--radius` token; null = built-in 10px. */
  radius: number | null;
  /** Whether UI animations/transitions play (T46); default on. */
  animations: boolean;
  /** Chat column max-width in px; `null` = off (full width). Default 760. */
  chatMaxWidth: number | null;

  /** Set one color pick for one mode, persist, and re-apply the overrides. */
  setColor: (mode: ColorMode, key: ColorKey, hex: string) => void;
  /** Clear one color pick for one mode (back to the theme's value). */
  resetColor: (mode: ColorMode, key: ColorKey) => void;
  /** Set (or clear with null) the derived-surface contrast for one mode. */
  setContrast: (mode: ColorMode, value: number | null) => void;
  /** Clear every color pick in both modes (full back-to-theme reset). */
  resetAllColors: () => void;
  /** Merge a partial typography update (null fields reset to default). */
  setTypography: (patch: Partial<TypographyPrefs>) => void;
  /** Switch the chat message layout style (T34). */
  setChatStyle: (style: ChatStyle) => void;
  /** Switch the sidebar chat-list row style (T35). */
  setChatListStyle: (style: ChatListStyle) => void;
  /** Set (or clear with null) the corner radius. */
  setRadius: (v: number | null) => void;
  /** Enable/disable UI animations globally (T46). */
  setAnimations: (enabled: boolean) => void;
  /** Set the chat column max-width (number = capped px, `null` = off). */
  setChatMaxWidth: (v: number | null) => void;
}

export const useAppearance = create<AppearanceState>((set, get) => ({
  colors: getStoredCustomColors(),
  typography: getStoredTypography(),
  chatStyle: getStoredChatStyle(),
  chatListStyle: getStoredChatListStyle(),
  radius: getStoredRadius(),
  animations: getStoredAnimations(),
  chatMaxWidth: getStoredChatMaxWidth(),

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

  setContrast: (mode, value) => {
    const cur = get().colors;
    const modeColors = { ...cur[mode] };
    if (value === null) delete modeColors.contrast;
    else modeColors.contrast = clampContrast(value);
    const colors: CustomColors = { ...cur, [mode]: modeColors };
    storeCustomColors(colors);
    applyCustomColors(colors);
    set({ colors });
  },

  resetAllColors: () => {
    const colors: CustomColors = { light: {}, dark: {} };
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

  setRadius: (v) => {
    storeRadius(v);
    applyCustomRadius(v);
    set({ radius: v === null ? null : clampSize(v, RADIUS) });
  },

  setChatStyle: (style) => {
    storeChatStyle(style);
    set({ chatStyle: style });
  },

  setChatListStyle: (style) => {
    storeChatListStyle(style);
    set({ chatListStyle: style });
  },

  setAnimations: (enabled) => {
    storeAnimations(enabled);
    applyAnimations(enabled);
    set({ animations: enabled });
  },
  setChatMaxWidth: (v) => {
    storeChatMaxWidth(v);
    set({ chatMaxWidth: v === null ? null : clampSize(v, CHAT_WIDTH) });
  },
}));

// Apply the stored overrides as soon as this module loads (before first
// paint), mirroring the light/dark bootstrap in `store/theme.ts`. The custom
// CSS wins over installed-theme CSS by selector specificity, so the apply
// order relative to the async theme load doesn't matter.
applyCustomColors(getStoredCustomColors());
applyCustomTypography(getStoredTypography());
applyCustomRadius(getStoredRadius());
applyAnimations(getStoredAnimations());
