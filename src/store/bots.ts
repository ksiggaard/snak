import { create } from "zustand";
import {
  createBot,
  deleteBot,
  listBots,
  renameBot,
  setBotAvatar,
  setBotDefaultModel,
  setBotInstructions,
  setBotTagline,
} from "@/lib/db";
import { useThreads } from "@/store/threads";
import type { Bot, Provider } from "@/types/db";

// Bot memory is intentionally NOT in this store: the editor loads/edits it
// component-locally via the lib/db helpers, like the global Memory card.

interface BotsState {
  bots: Bot[];
  /** Bot whose editor view is open in the main pane, or null. */
  openBotId: string | null;
  initialized: boolean;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  create: () => Promise<Bot>;
  rename: (id: string, name: string) => Promise<void>;
  setInstructions: (id: string, instructions: string) => Promise<void>;
  setTagline: (id: string, tagline: string) => Promise<void>;
  setAvatar: (
    id: string,
    mediaType: string | null,
    data: string | null,
  ) => Promise<void>;
  setDefaultModel: (
    id: string,
    provider: Provider | null,
    model: string | null,
  ) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Open a bot's editor view. */
  open: (id: string) => void;
  /** Close the bot editor view. */
  close: () => void;
}

export const useBots = create<BotsState>((set, get) => ({
  bots: [],
  openBotId: null,
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    set({ bots: await listBots(), initialized: true });
  },

  refresh: async () => {
    set({ bots: await listBots() });
  },

  create: async () => {
    const bot = await createBot();
    await get().refresh();
    return bot;
  },

  rename: async (id, name) => {
    await renameBot(id, name.trim() || "New bot");
    await get().refresh();
  },

  setInstructions: async (id, instructions) => {
    await setBotInstructions(id, instructions);
    await get().refresh();
  },

  setTagline: async (id, tagline) => {
    await setBotTagline(id, tagline.trim());
    await get().refresh();
  },

  setAvatar: async (id, mediaType, data) => {
    await setBotAvatar(id, mediaType, data);
    await get().refresh();
  },

  setDefaultModel: async (id, provider, model) => {
    await setBotDefaultModel(id, provider, model);
    await get().refresh();
  },

  remove: async (id) => {
    await deleteBot(id);
    if (get().openBotId === id) {
      set({ openBotId: null });
    }
    await get().refresh();
    // Threads were orphaned to no-bot — reflect that in the thread list.
    await useThreads.getState().refreshThreads();
  },

  open: (id) => {
    set({ openBotId: id });
  },

  close: () => {
    set({ openBotId: null });
  },
}));
