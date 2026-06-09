import { create } from "zustand";
import {
  addAttachment,
  addMessage,
  addUsage,
  createThread,
  deleteThread,
  getProject,
  getSetting,
  listProjectFiles,
  listThreads,
  renameThread,
  setSetting,
  setThreadProject,
  setThreadProviderModel,
} from "@/lib/db";
import { cancelStream, chatStream, type ApiMessage } from "@/lib/chat";
import { loadThreadMessages, type MessageView } from "@/lib/messages";
import { buildProjectSystemText } from "@/lib/projects";
import { PROVIDERS } from "@/lib/providers";
import type { PreparedImage } from "@/lib/image";
import type { Provider, Thread } from "@/types/db";

const LAST_THREAD_KEY = "last_thread_id";
// Sentinel id for the in-progress assistant message shown while streaming;
// replaced by the persisted DB row once the stream completes.
const STREAM_ID = "__streaming__";

/** Derive a thread title from the first user message. */
export function deriveTitle(content: string): string {
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
  /** Project a new (draft) chat will be created in, or null for none. */
  draftProjectId: string | null;
  busy: boolean;
  /** True between requesting a cancel and the stream actually stopping. */
  cancelling: boolean;
  error: string | null;
  initialized: boolean;

  init: () => Promise<void>;
  refreshThreads: () => Promise<void>;
  selectThread: (id: string) => Promise<void>;
  startNewChat: () => void;
  /** Start a new draft chat that will be created inside the given project. */
  startNewChatInProject: (projectId: string) => void;
  /** Move an existing thread into a project (or null to remove it). */
  assignThreadProject: (
    threadId: string,
    projectId: string | null,
  ) => Promise<void>;
  /** Set provider+model for the current thread, or the draft if none. */
  setProviderModel: (provider: Provider, model: string) => Promise<void>;
  send: (content: string, images: PreparedImage[]) => Promise<void>;
  /** Stop the in-flight stream; partial text is persisted via the normal path. */
  cancel: () => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Turn a raw error (Tauri command rejection string or JS Error) into a friendly,
 * actionable message for the chat error banner. Provider modules already surface
 * the upstream status + body (e.g. "provider error 401: {...}"); we add guidance
 * for the common failure classes and keep the original detail where useful.
 */
function friendlyError(e: unknown): string {
  const raw = errMsg(e);
  const lower = raw.toLowerCase();

  if (lower.includes("no api key")) {
    return raw; // already actionable ("…Add one in Settings.")
  }
  if (lower.includes("no model selected")) {
    return raw;
  }
  // reqwest connect/DNS/timeout failures bubble up as "… request failed: …".
  if (
    lower.includes("request failed") ||
    lower.includes("dns") ||
    lower.includes("connection") ||
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("network")
  ) {
    return `Network error — couldn't reach the provider. Check your connection and try again. (${raw})`;
  }
  // Provider HTTP errors: "anthropic error 401: …" / "provider error 429: …".
  const statusMatch = raw.match(/error (\d{3})\b/);
  if (statusMatch) {
    const code = Number(statusMatch[1]);
    if (code === 401 || code === 403) {
      return `Authentication failed (${code}) — your API key may be invalid or expired. Update it in Settings. (${raw})`;
    }
    if (code === 404) {
      return `Not found (404) — the model name may be wrong for this provider. Check the model field. (${raw})`;
    }
    if (code === 429) {
      return `Rate limited (429) — too many requests or quota exceeded. Wait a moment and retry. (${raw})`;
    }
    if (code >= 500) {
      return `The provider had a server error (${code}). Try again shortly. (${raw})`;
    }
    return `The provider rejected the request (${code}). ${raw}`;
  }
  return raw;
}

export const useThreads = create<ThreadsState>((set, get) => ({
  threads: [],
  currentThreadId: null,
  messages: [],
  draftProvider: PROVIDERS[0].id,
  draftModel: PROVIDERS[0].defaultModel,
  draftProjectId: null,
  busy: false,
  cancelling: false,
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
    set({
      currentThreadId: null,
      messages: [],
      error: null,
      draftProjectId: null,
    });
  },

  startNewChatInProject: (projectId) => {
    set({
      currentThreadId: null,
      messages: [],
      error: null,
      draftProjectId: projectId,
    });
  },

  assignThreadProject: async (threadId, projectId) => {
    await setThreadProject(threadId, projectId);
    await get().refreshThreads();
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
    // Ignore empty/whitespace-only sends with no attachments.
    if (!content.trim() && images.length === 0) return;
    if (get().busy) return;
    set({ busy: true, cancelling: false, error: null });
    try {
      let id = get().currentThreadId;
      let provider: Provider;
      let model: string;
      let projectId: string | null;

      if (!id) {
        provider = get().draftProvider;
        model = get().draftModel;
        projectId = get().draftProjectId;
        const thread = await createThread({
          provider,
          model,
          title: deriveTitle(content || "Image"),
          projectId,
        });
        id = thread.id;
        set({ currentThreadId: id });
        await setSetting(LAST_THREAD_KEY, id);
        await get().refreshThreads();
      } else {
        const t = get().threads.find((x) => x.id === id)!;
        provider = t.provider;
        model = t.model;
        projectId = t.project_id;
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

      const history: ApiMessage[] = afterUser.map((m) => ({
        role: m.role,
        content: m.content,
        images: m.images,
      }));

      // Project base context: inject the project's instructions + reference
      // files as a leading system message so every request in the project
      // carries it. Rides the existing role:"system" handling in each provider
      // (Anthropic top-level `system`, Gemini `systemInstruction`, OpenAI/Mistral
      // pass-through) — no provider/Rust changes. Ordered before history.
      if (projectId) {
        const project = await getProject(projectId);
        if (project) {
          const files = await listProjectFiles(projectId);
          const systemText = buildProjectSystemText(project, files);
          if (systemText) {
            history.unshift({
              role: "system",
              content: systemText,
              images: [],
            });
          }
        }
      }

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

      // On cancellation this still resolves with the partial text accumulated
      // so far (the backend early-exits and returns Ok), so the same
      // persistence path preserves whatever was generated.
      const result = await chatStream(provider, model, history, onDelta);
      // Don't persist an empty assistant row (e.g. cancelled before any token).
      if (result.content.length > 0) {
        const assistantMsg = await addMessage({
          thread_id: id,
          role: "assistant",
          content: result.content,
        });
        // Record token usage for this response. Attribute it to the model the
        // API actually used (`result.model`), falling back to the requested
        // model — so usage stays correct even if the thread's model changes
        // later. Skip if the provider reported no tokens at all (e.g. an early
        // cancel that still emitted text but no usage event).
        const u = result.usage;
        if (
          u &&
          (u.input_tokens > 0 ||
            u.output_tokens > 0 ||
            u.cache_creation_tokens > 0 ||
            u.cache_read_tokens > 0)
        ) {
          await addUsage({
            message_id: assistantMsg.id,
            thread_id: id,
            provider,
            model: result.model || model,
            input_tokens: u.input_tokens,
            output_tokens: u.output_tokens,
            cache_creation_tokens: u.cache_creation_tokens,
            cache_read_tokens: u.cache_read_tokens,
          });
        }
      }
      // Replace the placeholder with the persisted rows.
      set({ messages: await loadThreadMessages(id) });
      // updated_at changed → reorder sidebar.
      await get().refreshThreads();
    } catch (e) {
      set({ error: friendlyError(e) });
      const id = get().currentThreadId;
      if (id) set({ messages: await loadThreadMessages(id) });
    } finally {
      set({ busy: false, cancelling: false });
    }
  },

  cancel: async () => {
    if (!get().busy || get().cancelling) return;
    set({ cancelling: true });
    try {
      await cancelStream();
    } catch {
      // If the cancel request itself fails, the stream will still complete
      // normally; nothing actionable to surface to the user.
      set({ cancelling: false });
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
