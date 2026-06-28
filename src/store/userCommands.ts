import { create } from "zustand";
import { getSetting, setSetting } from "@/lib/db";
import { parseUserCommands, type UserSlashCommand } from "@/lib/slashCommands";

/**
 * User-authored slash commands (Settings → Slash commands). Lazy-init store
 * mirroring `useQuickActions`: the list loads once from a `settings` row (JSON)
 * and saves back as JSON. The Settings card and the Composer's command palette
 * both read this store, so edits reflect live. No defaults — an empty list is a
 * fresh install with no custom commands.
 */
const KEY = "user_slash_commands";

interface UserCommandsState {
  commands: UserSlashCommand[];
  initialized: boolean;
  init: () => Promise<void>;
  /** Persist a new list and update the store. */
  save: (commands: UserSlashCommand[]) => Promise<void>;
}

export const useUserCommands = create<UserCommandsState>((set, get) => ({
  commands: [],
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    const stored = await getSetting(KEY);
    set({ commands: parseUserCommands(stored), initialized: true });
  },

  save: async (commands) => {
    await setSetting(KEY, JSON.stringify(commands));
    set({ commands, initialized: true });
  },
}));
