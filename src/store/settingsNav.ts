import { create } from "zustand";
import type { SettingsCategoryId } from "@/lib/settingsSections";

/** Which settings category is shown in the main pane. Shared between the
 *  sidebar "settings" list pane (sets it) and SettingsView (reads it), so the
 *  category picker moved out of SettingsView into the standard list pane. */
interface SettingsNavState {
  category: SettingsCategoryId;
  setCategory: (id: SettingsCategoryId) => void;
}

export const useSettingsNav = create<SettingsNavState>((set) => ({
  category: "models",
  setCategory: (category) => set({ category }),
}));
