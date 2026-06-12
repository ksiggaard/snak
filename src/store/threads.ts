import { create } from "zustand";
import {
  addAttachment,
  addMessage,
  addUsage,
  createThread,
  deleteArchivedThreads,
  deleteThread,
  getProject,
  getSetting,
  listProjectFiles,
  listThreads,
  listUserMemory,
  purgeEphemeralThreads,
  renameThread,
  setSetting,
  setThreadArchived,
  setThreadFavorite,
  setThreadProject,
  setThreadProviderModel,
  SYSTEM_PROMPT_ADDENDUM_KEY,
} from "@/lib/db";
import {
  cancelStream,
  chatStream,
  type ApiMessage,
  type StreamEvent,
} from "@/lib/chat";
import {
  loadThreadMessages,
  type MessageToolCall,
  type MessageView,
} from "@/lib/messages";
import { buildCompactionRequest, compactHistory } from "@/lib/compaction";
import { buildProjectSystemText } from "@/lib/projects";
import { buildSkillsSystemText } from "@/lib/skills";
import { selectRegistry, usePlugins } from "@/store/plugins";
import { buildGlobalSystemText } from "@/lib/systemContext";
import { t } from "@/store/i18n";
import { PROVIDERS } from "@/lib/providers";
import type { PreparedImage } from "@/lib/image";
import type { PendingDocument } from "@/lib/documents";
import type { Provider, Thread } from "@/types/db";

const LAST_THREAD_KEY = "last_thread_id";
export const DEFAULT_PROVIDER_KEY = "default_provider";
export const DEFAULT_MODEL_KEY = "default_model";
// Sentinel id for the in-progress assistant message shown while streaming;
// replaced by the persisted DB row once the stream completes.
const STREAM_ID = "__streaming__";

/** Derive a thread title from the first user message. `fallback` is used for
 * an empty message (callers pass the localized "New chat"; English default
 * keeps the fn pure/test-stable). */
export function deriveTitle(content: string, fallback = "New chat"): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  return oneLine.length > 48 ? `${oneLine.slice(0, 48)}…` : oneLine || fallback;
}

/**
 * Whether a thread may be persisted as `last_thread_id` (T29). Incognito
 * (ephemeral) threads are session-only — remembering one would point the next
 * launch at a thread the startup purge has just deleted, so they are never
 * recorded. An unknown thread (undefined) is remembered, preserving the
 * pre-T29 behavior for ordinary threads. Pure (unit-tested).
 */
export function shouldRememberThread(
  thread: Pick<Thread, "ephemeral"> | undefined,
): boolean {
  return !thread?.ephemeral;
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
  /** Incognito draft (T29): the first send creates the thread `ephemeral`. */
  draftIncognito: boolean;
  busy: boolean;
  /** A compaction summarization call is in flight (T28; busy is also set). */
  compacting: boolean;
  /** True between requesting a cancel and the stream actually stopping. */
  cancelling: boolean;
  error: string | null;
  initialized: boolean;

  init: () => Promise<void>;
  refreshThreads: () => Promise<void>;
  selectThread: (id: string) => Promise<void>;
  /** Start a new draft chat; `incognito` makes it session-only (T29). */
  startNewChat: (opts?: { incognito?: boolean }) => void;
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
  send: (
    content: string,
    images: PreparedImage[],
    documents?: PendingDocument[],
  ) => Promise<void>;
  /**
   * Persist a synthetic assistant-role note into the current thread (creating a
   * draft thread lazily, like `send`). Used by slash commands (T14) to feed a
   * backend action's confirmation/output into the conversation without going
   * through the LLM. Does not stream or call a provider.
   */
  postNote: (content: string) => Promise<void>;
  /**
   * Compact the current thread (T28): ask its provider/model to summarize the
   * history since the last compaction point and persist the result as a
   * synthetic `kind: "summary"` row. Non-destructive — all rows are kept;
   * subsequent sends carry [summary + messages after it] (see lib/compaction).
   */
  compact: () => Promise<void>;
  /** Stop the in-flight stream; partial text is persisted via the normal path. */
  cancel: () => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  /** Pin/unpin a thread to the sidebar Favorites group (T23). */
  toggleFavorite: (id: string) => Promise<void>;
  /** Archive ("close the tab") or un-archive a thread. Archiving the current
   * thread moves the view to the next open thread (or a fresh draft). */
  setArchived: (id: string, archived: boolean) => Promise<void>;
  /** Permanently delete every archived thread. */
  clearArchive: () => Promise<void>;
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
  draftIncognito: false,
  busy: false,
  compacting: false,
  cancelling: false,
  error: null,
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    // T29: purge incognito threads from the previous session FIRST — before
    // the thread list is loaded or last_thread_id restored. Running on startup
    // makes the purge crash-safe: even a kill/crash (or tray-Quit's app.exit,
    // which the frontend cannot intercept) never leaks an incognito chat into
    // this session. The quit-time purge in App.tsx is only best-effort.
    await purgeEphemeralThreads();
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
    const thread = get().threads.find((t) => t.id === id);
    // Tabs metaphor: opening an archived chat promotes it back to open.
    if (thread?.archived) {
      await setThreadArchived(id, false);
      await get().refreshThreads();
    }
    // Incognito threads are never remembered as last_thread_id (T29) — the
    // startup purge would have deleted them before restore anyway.
    if (shouldRememberThread(thread)) await setSetting(LAST_THREAD_KEY, id);
  },

  startNewChat: (opts) => {
    set({
      currentThreadId: null,
      messages: [],
      error: null,
      draftProjectId: null,
      draftIncognito: opts?.incognito ?? false,
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
      draftIncognito: false,
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

  send: async (content, images, documents = []) => {
    // Ignore empty/whitespace-only sends with no attachments.
    if (!content.trim() && images.length === 0 && documents.length === 0)
      return;
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
        const ephemeral = get().draftIncognito;
        const thread = await createThread({
          provider,
          model,
          // Attachment-only sends title from the first document's name, or
          // the localized "Image" fallback (mirrors the image-only case).
          title: deriveTitle(
            content || documents[0]?.name || t("thread.image"),
            t("thread.newChat"),
          ),
          projectId,
          ephemeral,
        });
        id = thread.id;
        set({ currentThreadId: id });
        // Incognito threads never become last_thread_id (T29).
        if (!ephemeral) await setSetting(LAST_THREAD_KEY, id);
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
      // Documents (T39): the *extracted text* is the payload; the original
      // file name rides in `filename` (migration 012).
      for (const d of documents) {
        await addAttachment({
          message_id: userMsg.id,
          kind: "document",
          media_type: d.mediaType,
          data: d.text,
          filename: d.name,
        });
      }
      const afterUser = await loadThreadMessages(id);
      set({ messages: afterUser });

      // Compacted API history (T28): everything after the latest `summary`
      // row, with that summary injected as a leading user turn — or the full
      // transcript when the thread was never compacted. Display is unaffected
      // (the store keeps every row); only the API context shrinks.
      const history: ApiMessage[] = compactHistory(afterUser);

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

      // Stream the reply, appending a placeholder assistant bubble on the first
      // event and growing it as chunks arrive. Text arrives as content deltas;
      // tool calls arrive as structured events and render as distinct chips.
      let acc = "";
      const toolCalls: MessageToolCall[] = [];
      const onDelta = (event: StreamEvent) => {
        if (event.toolCall) {
          toolCalls.push({
            name: event.toolCall.name,
            url: event.toolCall.url,
          });
        }
        if (event.text) acc += event.text;
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
                  kind: "normal" as const,
                  duration_ms: null,
                  created_at: "",
                  images: [],
                  documents: [],
                  toolCalls: [],
                },
              ];
          return {
            messages: base.map((m) =>
              m.id === STREAM_ID
                ? { ...m, content: acc, toolCalls: [...toolCalls] }
                : m,
            ),
          };
        });
      };

      // On cancellation this still resolves with the partial text accumulated
      // so far (the backend early-exits and returns Ok), so the same
      // persistence path preserves whatever was generated.
      const started = Date.now();
      const result = await chatStream(provider, model, history, onDelta);
      // Persist the assistant turn when it produced text or invoked a tool.
      // (Skip a truly empty row, e.g. cancelled before any token or tool call.)
      if (result.content.length > 0 || toolCalls.length > 0) {
        const assistantMsg = await addMessage({
          thread_id: id,
          role: "assistant",
          content: result.content,
          duration_ms: Math.round(Date.now() - started),
        });
        // Persist each tool call as a structured attachment so it survives
        // reload and renders as a distinct chip — never as model-authored text.
        for (const tc of toolCalls) {
          await addAttachment({
            message_id: assistantMsg.id,
            kind: "tool_call",
            media_type: "application/json",
            data: JSON.stringify(tc),
          });
        }
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
      const ephemeral = get().draftIncognito;
      const thread = await createThread({
        provider: get().draftProvider,
        model: get().draftModel,
        title: deriveTitle(content, t("thread.newChat")),
        projectId: get().draftProjectId,
        ephemeral,
      });
      id = thread.id;
      set({ currentThreadId: id });
      // Incognito threads never become last_thread_id (T29).
      if (!ephemeral) await setSetting(LAST_THREAD_KEY, id);
    }
    await addMessage({ thread_id: id, role: "assistant", content });
    set({ messages: await loadThreadMessages(id) });
    await get().refreshThreads();
  },

  compact: async () => {
    const id = get().currentThreadId;
    if (!id || get().busy || get().compacting) return;
    const thread = get().threads.find((t) => t.id === id);
    if (!thread) return;
    // `busy` is set too so sends are blocked and Stop can cancel the call —
    // the same in-flight conventions as a normal stream.
    set({ busy: true, compacting: true, cancelling: false, error: null });
    try {
      const request = buildCompactionRequest(get().messages);
      // No streaming placeholder: the summary isn't a chat bubble; it lands as
      // a divider row once persisted.
      const result = await chatStream(
        thread.provider,
        thread.model,
        request,
        () => {},
      );
      // Stopped mid-summarization → don't persist a truncated summary; the
      // thread simply stays uncompacted.
      if (get().cancelling) return;
      const content = result.content.trim();
      if (!content) {
        throw new Error("The model returned an empty summary — not compacted.");
      }
      const summaryMsg = await addMessage({
        thread_id: id,
        role: "assistant",
        content,
        kind: "summary",
      });
      // Attribute the summarization call's tokens like any other response (T16).
      const u = result.usage;
      if (
        u &&
        (u.input_tokens > 0 ||
          u.output_tokens > 0 ||
          u.cache_creation_tokens > 0 ||
          u.cache_read_tokens > 0)
      ) {
        await addUsage({
          message_id: summaryMsg.id,
          thread_id: id,
          provider: thread.provider,
          model: result.model || thread.model,
          input_tokens: u.input_tokens,
          output_tokens: u.output_tokens,
          cache_creation_tokens: u.cache_creation_tokens,
          cache_read_tokens: u.cache_read_tokens,
        });
      }
      set({ messages: await loadThreadMessages(id) });
      await get().refreshThreads();
    } catch (e) {
      set({ error: friendlyError(e) });
    } finally {
      set({ busy: false, compacting: false, cancelling: false });
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
    await renameThread(id, title.trim() || t("thread.untitled"));
    await get().refreshThreads();
  },

  toggleFavorite: async (id) => {
    const t = get().threads.find((x) => x.id === id);
    if (!t) return;
    await setThreadFavorite(id, !t.favorite);
    await get().refreshThreads();
  },

  setArchived: async (id, archived) => {
    await setThreadArchived(id, archived);
    await get().refreshThreads();
    // Tabs metaphor: closing the active tab switches to the next open one
    // (or an empty draft when none are left).
    if (archived && get().currentThreadId === id) {
      const next = get().threads.find((x) => !x.archived);
      if (next) await get().selectThread(next.id);
      else get().startNewChat();
    }
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

  clearArchive: async () => {
    const wasViewingArchived = get().threads.some(
      (t) => t.id === get().currentThreadId && t.archived,
    );
    await deleteArchivedThreads();
    const threads = await listThreads();
    set({ threads });
    if (wasViewingArchived) {
      if (threads.length > 0) await get().selectThread(threads[0].id);
      else get().startNewChat();
    }
  },
}));
