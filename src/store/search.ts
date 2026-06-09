import { create } from "zustand";
import { searchHistory } from "@/lib/db";
import { groupHitsByThread } from "@/lib/search";
import { useProjects } from "@/store/projects";
import { useThreads } from "@/store/threads";
import type { SearchHit, ThreadSearchGroup } from "@/types/db";

// T19 search state, kept in its own small store so it doesn't touch the threads
// store's send()/selectThread internals (it only *calls* the existing
// selectThread action to open a result).

interface SearchState {
  /** Whether the search results overlay is shown. */
  open: boolean;
  query: string;
  results: ThreadSearchGroup[];
  /** Raw flat hits (for testing / future use). */
  hits: SearchHit[];
  searching: boolean;
  /** True once a query has been run (to distinguish "no results" from idle). */
  ran: boolean;
  /**
   * Message id a freshly-opened thread should scroll to + briefly highlight.
   * MessageList consumes this and clears it once handled.
   */
  scrollToMessageId: string | null;

  setQuery: (query: string) => void;
  /** Run the search for the current query (debounce in the caller/UI). */
  run: () => Promise<void>;
  /** Close + clear the search overlay. */
  clear: () => void;
  /** Open a search result: select its thread and request scroll-to-message. */
  openHit: (hit: SearchHit) => Promise<void>;
  /** Called by MessageList after it scrolls, to consume the pending target. */
  consumeScroll: () => void;
}

export const useSearch = create<SearchState>((set, get) => ({
  open: false,
  query: "",
  results: [],
  hits: [],
  searching: false,
  ran: false,
  scrollToMessageId: null,

  setQuery: (query) => {
    set({ query, open: query.trim().length > 0 ? get().open : false });
  },

  run: async () => {
    const query = get().query;
    if (query.trim().length === 0) {
      set({ results: [], hits: [], open: false, ran: false });
      return;
    }
    set({ searching: true, open: true });
    try {
      const hits = await searchHistory(query);
      set({ hits, results: groupHitsByThread(hits), ran: true });
    } finally {
      set({ searching: false });
    }
  },

  clear: () => {
    set({ query: "", results: [], hits: [], open: false, ran: false });
  },

  openHit: async (hit) => {
    // Reuse the existing threads-store action; never touches send/selectThread
    // internals — just invokes the public action. Also close any open project
    // pane so the main area returns to the chat view.
    useProjects.getState().close();
    await useThreads.getState().selectThread(hit.thread_id);
    set({
      open: false,
      scrollToMessageId: hit.kind === "message" ? hit.message_id : null,
    });
  },

  consumeScroll: () => set({ scrollToMessageId: null }),
}));
