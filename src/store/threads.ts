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
  listUserMemory,
  renameThread,
  setSetting,
  setThreadProject,
  setThreadProviderModel,
  SYSTEM_PROMPT_ADDENDUM_KEY,
} from "@/lib/db";
import { cancelStream, chatStream, type ApiMessage } from "@/lib/chat";
import { loadThreadMessages, type MessageView } from "@/lib/messages";
import { buildProjectSystemText } from "@/lib/projects";
import { buildSkillsSystemText } from "@/lib/skills";
import { selectRegistry, usePlugins } from "@/store/plugins";
import { buildGlobalSystemText } from "@/lib/systemContext";
import { PROVIDERS } from "@/lib/providers";
import type { PreparedImage } from "@/lib/image";
import type { Provider, Thread } from "@/types/db";

const LAST_THREAD_KEY = "last_thread_id";
const DEFAULT_PROVIDER_KEY = "default_provider";
const DEFAULT_MODEL_KEY = "default_model";
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

/** The default provider+model for new interactions. */
export interface DefaultModel {
  provider: Provider;
  model: string;
}

/**
 * Resolve the persisted default (the `default_provider` / `default_model`
 * settings strings) into a concrete provider+model, falling back to the first
 * built-in provider when unset. Pure. The two keys are always written together
 * by `setDefaultModel`, so they are either both present or both absent.
 */
export function resolveDefault(
  provider: string | null,
  model: string | null,
): DefaultModel {
  if (provider && model) return { provider: provider as Provider, model };
  return { provider: PROVIDERS[0].id, model: PROVIDERS[0].defaultModel };
}

interface ThreadsState {
  threads: Thread[];
  /** null = an unsaved draft chat (created in the DB on first message). */
  currentThreadId: string | null;
  messages: MessageView[];
  draftProvider: Provider;
  draftModel: string;
  /** Provider/model new interactions start from (persisted default). */
  defaultProvider: Provider;
  defaultModel: string;
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
  /** Persist the default provider+model for new interactions. */
  setDefaultModel: (provider: Provider, model: string) => Promise<void>;
  send: (content: string, images: PreparedImage[]) => Promise<void>;
  /**
   * Persist a synthetic assistant-role note into the current thread (creating a
   * draft thread lazily, like `send`). Used by slash commands (T14) to feed a
   * backend action's confirmation/output into the conversation without going
   * through the LLM. Does not stream or call a provider.
   */
  postNote: (content: string) => Promise<void>;
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
  defaultProvider: PROVIDERS[0].id,
  defaultModel: PROVIDERS[0].defaultModel,
  draftProjectId: null,
  busy: false,
  cancelling: false,
  error: null,
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    const threads = await listThreads();
    set({ threads, initialized: true });
    // Load the persisted default and seed the draft from it before deciding
    // which thread to open, so a fresh-draft launch starts on the default.
    const [dp, dm] = await Promise.all([
      getSetting(DEFAULT_PROVIDER_KEY),
      getSetting(DEFAULT_MODEL_KEY),
    ]);
    const def = resolveDefault(dp, dm);
    set({
      defaultProvider: def.provider,
      defaultModel: def.model,
      draftProvider: def.provider,
      draftModel: def.model,
    });
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
      draftProvider: get().defaultProvider,
      draftModel: get().defaultModel,
    });
  },

  startNewChatInProject: (projectId) => {
    set({
      currentThreadId: null,
      messages: [],
      error: null,
      draftProjectId: projectId,
      draftProvider: get().defaultProvider,
      draftModel: get().defaultModel,
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

  setDefaultModel: async (provider, model) => {
    await setSetting(DEFAULT_PROVIDER_KEY, provider);
    await setSetting(DEFAULT_MODEL_KEY, model);
    // When the user is on an unsaved draft, reflect the change in the live
    // draft immediately (so the model picker updates); otherwise just cache it.
    const onDraft = get().currentThreadId === null;
    set({
      defaultProvider: provider,
      defaultModel: model,
      ...(onDraft ? { draftProvider: provider, draftModel: model } : {}),
    });
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

      // Leading system context, assembled at the message layer (not in the
      // Rust providers). Precedence is global → project → thread; since we
      // prepend, the project message is unshifted first and the global one
      // second, so the array ends up ordered [global, project, ...history].
      // Each provider concatenates consecutive role:"system" messages in array
      // order (Anthropic/Gemini join with "\n\n"; OpenAI/Mistral pass them
      // through), so this realizes the documented precedence without any
      // provider/Rust changes.

      // Project base context (T20): the project's instructions + reference
      // files, for threads that belong to a project.
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

      // Global system context (T10): the custom system-prompt addendum + the
      // user's memory entries. Global (applies to every thread/provider).
      // Unshifted last so it sits first — ahead of the project message.
      const [addendum, memory] = await Promise.all([
        getSetting(SYSTEM_PROMPT_ADDENDUM_KEY),
        listUserMemory(),
      ]);
      const globalSystemText = buildGlobalSystemText(addendum, memory);
      if (globalSystemText) {
        history.unshift({
          role: "system",
          content: globalSystemText,
          images: [],
        });
      }

      // Enabled skills (T15): instruction packs from `skill` plugins, alongside
      // the global guidance — unshifted last so they lead the system context.
      const skillsSystemText = buildSkillsSystemText(
        selectRegistry(usePlugins.getState()).skills,
      ); // T15 wire-in
      if (skillsSystemText)
        history.unshift({
          role: "system",
          content: skillsSystemText,
          images: [],
        });

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

  postNote: async (content) => {
    if (!content.trim()) return;
    let id = get().currentThreadId;
    if (!id) {
      const thread = await createThread({
        provider: get().draftProvider,
        model: get().draftModel,
        title: deriveTitle(content),
        projectId: get().draftProjectId,
      });
      id = thread.id;
      set({ currentThreadId: id });
      await setSetting(LAST_THREAD_KEY, id);
    }
    await addMessage({ thread_id: id, role: "assistant", content });
    set({ messages: await loadThreadMessages(id) });
    await get().refreshThreads();
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
