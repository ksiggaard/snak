import { create } from "zustand";
import { getQuickActions, setQuickActions } from "@/lib/db";
import {
  DEFAULT_QUICK_ACTIONS,
  parseQuickActions,
  serializeQuickActions,
  type QuickAction,
} from "@/lib/quickActions";

/**
 * Global quick actions (the empty new-chat starters). Lazy-init store mirroring
 * `useWorkspaces`/`useBots`: the list is loaded once from the `settings` table and
 * saved back as JSON. A fresh install (no stored value) seeds the built-in
 * defaults so the empty screen is never blank. The Settings card and the empty
 * screen both read this store, so edits reflect live.
 */
interface QuickActionsState {
  actions: QuickAction[];
  initialized: boolean;
  init: () => Promise<void>;
  /** Persist a new list and update the store. */
  save: (actions: QuickAction[]) => Promise<void>;
}

export const useQuickActions = create<QuickActionsState>((set, get) => ({
  actions: DEFAULT_QUICK_ACTIONS,
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    const stored = await getQuickActions();
    // Absent value → defaults; a stored value parses tolerantly (an explicitly
    // emptied list stays empty — the user removed every action on purpose).
    set({
      actions:
        stored === null ? DEFAULT_QUICK_ACTIONS : parseQuickActions(stored),
      initialized: true,
    });
  },

  save: async (actions) => {
    await setQuickActions(serializeQuickActions(actions));
    set({ actions, initialized: true });
  },
}));
