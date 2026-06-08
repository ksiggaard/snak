import { create } from "zustand";
import {
  addAttachment,
  addMessage,
  createThread,
  deleteThread,
  getSetting,
  listThreads,
  renameThread,
  setSetting,
  setThreadProviderModel,
} from "@/lib/db";
import { chatStream } from "@/lib/chat";
import { loadThreadMessages, type MessageView } from "@/lib/messages";
import { PROVIDERS } from "@/lib/providers";
import type { PreparedImage } from "@/lib/image";
import type { Provider, Thread } from "@/types/db";

const LAST_THREAD_KEY = "last_thread_id";
// Sentinel id for the in-progress assistant message shown while streaming;
// replaced by the persisted DB row once the stream completes.
const STREAM_ID = "__streaming__";

/** Derive a thread title from the first user message. */
function deriveTitle(content: string): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  return oneLine.length > 48
    ? `${oneLine.slice(0, 48)}…`
    : oneLine || "New chat";
}

interface ThreadsState {
  threads: Thread[];
  /** null = an unsaved draft chat (created in the DB on first message). */
  currentThreadId: string | null;
  messages: MessageView[];
  draftProvider: Provider;
  draftModel: string;
  busy: boolean;
  error: string | null;
  initialized: boolean;

  init: () => Promise<void>;
  refreshThreads: () => Promise<void>;
  selectThread: (id: string) => Promise<void>;
  startNewChat: () => void;
  /** Set provider+model for the current thread, or the draft if none. */
  setProviderModel: (provider: Provider, model: string) => Promise<void>;
  send: (content: string, images: PreparedImage[]) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useThreads = create<ThreadsState>((set, get) => ({
  threads: [],
  currentThreadId: null,
  messages: [],
  draftProvider: PROVIDERS[0].id,
  draftModel: PROVIDERS[0].defaultModel,
  busy: false,
  error: null,
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    const threads = await listThreads();
    set({ threads, initialized: true });
    const lastId = await getSetting(LAST_THREAD_KEY);
    if (lastId && threads.some((t) => t.id === lastId)) {
      await get().selectThread(lastId);
    } else if (threads.length > 0) {
      await get().selectThread(threads[0].id);
    } else {
      get().startNewChat();
    }
  },

  refreshThreads: async () => {
    set({ threads: await listThreads() });
  },

  selectThread: async (id) => {
    const messages = await loadThreadMessages(id);
    set({ currentThreadId: id, messages, error: null });
    await setSetting(LAST_THREAD_KEY, id);
  },

  startNewChat: () => {
    set({ currentThreadId: null, messages: [], error: null });
  },

  setProviderModel: async (provider, model) => {
    const id = get().currentThreadId;
    if (!id) {
      set({ draftProvider: provider, draftModel: model });
      return;
    }
    await setThreadProviderModel(id, provider, model);
    await get().refreshThreads();
  },

  send: async (content, images) => {
    set({ busy: true, error: null });
    try {
      let id = get().currentThreadId;
      let provider: Provider;
      let model: string;

      if (!id) {
        provider = get().draftProvider;
        model = get().draftModel;
        const thread = await createThread({
          provider,
          model,
          title: deriveTitle(content || "Image"),
        });
        id = thread.id;
        set({ currentThreadId: id });
        await setSetting(LAST_THREAD_KEY, id);
        await get().refreshThreads();
      } else {
        const t = get().threads.find((x) => x.id === id)!;
        provider = t.provider;
        model = t.model;
      }

      const userMsg = await addMessage({
        thread_id: id,
        role: "user",
        content,
      });
      for (const img of images) {
        await addAttachment({
          message_id: userMsg.id,
          kind: "image",
          media_type: img.mediaType,
          data: img.base64,
        });
      }
      const afterUser = await loadThreadMessages(id);
      set({ messages: afterUser });

      const history = afterUser.map((m) => ({
        role: m.role,
        content: m.content,
        images: m.images,
      }));

      // Stream the reply, appending a placeholder assistant bubble on the
      // first delta and growing it as chunks arrive.
      let acc = "";
      const onDelta = (text: string) => {
        acc += text;
        set((s) => {
          const exists = s.messages.some((m) => m.id === STREAM_ID);
          const base = exists
            ? s.messages
            : [
                ...s.messages,
                {
                  id: STREAM_ID,
                  thread_id: id!,
                  role: "assistant" as const,
                  content: "",
                  created_at: "",
                  images: [],
                },
              ];
          return {
            messages: base.map((m) =>
              m.id === STREAM_ID ? { ...m, content: acc } : m,
            ),
          };
        });
      };

      const result = await chatStream(provider, model, history, onDelta);
      await addMessage({
        thread_id: id,
        role: "assistant",
        content: result.content,
      });
      // Replace the placeholder with the persisted rows.
      set({ messages: await loadThreadMessages(id) });
      // updated_at changed → reorder sidebar.
      await get().refreshThreads();
    } catch (e) {
      set({ error: errMsg(e) });
      const id = get().currentThreadId;
      if (id) set({ messages: await loadThreadMessages(id) });
    } finally {
      set({ busy: false });
    }
  },

  rename: async (id, title) => {
    await renameThread(id, title.trim() || "Untitled");
    await get().refreshThreads();
  },

  remove: async (id) => {
    await deleteThread(id);
    const threads = await listThreads();
    set({ threads });
    if (get().currentThreadId === id) {
      if (threads.length > 0) {
        await get().selectThread(threads[0].id);
      } else {
        get().startNewChat();
      }
    }
  },
}));
