import { create } from "zustand";

/** The main-pane view. Project/search panes are driven by their own stores and
 *  take precedence over "chat" but not over "settings"/"usage" (see App.tsx). */
export type MainView = "chat" | "settings" | "usage";

interface ViewState {
  view: MainView;
  setView: (v: MainView) => void;
  /** Toggle a chrome view (settings/usage) off back to chat, or on. */
  toggleView: (v: "settings" | "usage") => void;
  /** Return to the chat/project pane. */
  showChat: () => void;
}

export const useView = create<ViewState>((set, get) => ({
  view: "chat",
  setView: (view) => set({ view }),
  toggleView: (v) => set({ view: get().view === v ? "chat" : v }),
  showChat: () => set({ view: "chat" }),
}));
