import { create } from "zustand";
import {
  addAttachment,
  addMessage,
  addUsage,
  createThread,
  deleteArchivedThreads,
  deleteThread,
  getBot,
  getWorkspace,
  getSetting,
  listBotMemory,
  listBots,
  listWorkspaceFiles,
  listWorkspaceMemory,
  restoreThreadPrePlannerModel,
  setThreadWorkspaceFilesExcluded,
  listThreads,
  listUserMemory,
  purgeEphemeralThreads,
  renameThread,
  selectVariant as dbSelectVariant,
  setSetting,
  setThreadArchived,
  setThreadDeepResearch,
  setThreadFavorite,
  setThreadPlannerActive,
  setThreadWorkspace,
  setThreadProviderModel,
  SYSTEM_PROMPT_ADDENDUM_KEY,
} from "@/lib/db";
import {
  approveToolCall,
  cancelStream,
  chatStream,
  type ApiMessage,
  type ApprovalRequestEvent,
  type StreamEvent,
} from "@/lib/chat";
import {
  applySubagentEvent,
  applyToolEvent,
  applyTraceEvent,
  isModelOutput,
  loadThreadMessages,
  persistableSubagent,
  persistableToolCall,
  type ApiTraceEntry,
  type MessageImage,
  type MessageSubagent,
  type MessageToolCall,
  type MessageView,
} from "@/lib/messages";
import {
  buildCompactionRequest,
  compactHistory,
  groupLabelingActive,
  type GroupContext,
} from "@/lib/compaction";
import { applyRegenSteer, applySourcesSteer } from "@/lib/variations";
import { estimateTokens } from "@/lib/contextSize";
import { buildBotSystemText, buildGroupChatSystemText } from "@/lib/bots";
import { extractMentions } from "@/lib/mentions";
import { runPersonaMemoryUpdate } from "@/lib/personaMemory";
import { buildWorkspaceSystemText, filterWorkspaceFiles } from "@/lib/workspaces";
import { buildSkillsSystemText } from "@/lib/skills";
import { buildArtifactsSystemText } from "@/lib/artifacts";
import { buildChartsSystemText } from "@/lib/charts";
import { buildMapsSystemText } from "@/lib/maps";
import { buildYouTubeSystemText } from "@/lib/youtube";
import { hasRenderer } from "@/lib/plugins";
import { selectRegistry, usePlugins } from "@/store/plugins";
import { useKeys } from "@/store/keys";
import { useModels } from "@/store/models";
import {
  buildPlannerSystemPrompt,
  buildCriticSystemPrompt,
  buildCriticRequest,
  parsePlan,
  parseCriticResponse,
  resolveStepVariables,
  stripPlanJsonFence,
  topologicalSort,
  type PlanStep,
} from "@/lib/planner";
import {
  buildGlobalSystemText,
  buildWorkspaceMemoryText,
} from "@/lib/systemContext";
import { mcpCloseThreadSessions } from "@/lib/mcp";
import { t } from "@/store/i18n";
import { isKeylessProvider, PROVIDERS } from "@/lib/providers";
import { createGate } from "@/lib/concurrency";
import { deriveOffline, useConnectivity } from "@/store/connectivity";
import type { PreparedImage } from "@/lib/image";
import type { PendingDocument } from "@/lib/documents";
import type { Bot, Provider, Thread } from "@/types/db";

const LAST_THREAD_KEY = "last_thread_id";
export const DEFAULT_PROVIDER_KEY = "default_provider";
export const DEFAULT_MODEL_KEY = "default_model";
export const PLANNER_PROVIDER_KEY = "planner_provider";
export const PLANNER_MODEL_KEY = "planner_model";
export const PLANNER_DEFAULT_KEY = "planner_default";
export const CRITIC_PROVIDER_KEY = "critic_provider";
export const CRITIC_MODEL_KEY = "critic_model";
// Sentinel id for the in-progress assistant message shown while streaming;
// replaced by the persisted DB row once the stream completes. Exported so the
// renderer can tell a not-yet-persisted placeholder from a real message (e.g.
// artifacts only persist once their message has a real id).
export const STREAM_ID = "__streaming__";
export const STREAM_STEP_PREFIX = "__stream__";

export interface StepProgress {
  id: string;
  description: string;
  provider: Provider;
  model: string;
  status: "pending" | "running" | "done";
}

export interface PlannerProgress {
  phase: "planning" | "critiquing" | "revising" | "dispatching" | "executing" | "completing";
  steps: StepProgress[];
  directModel?: string;
  /** Current critique round (1-based), set during critiquing/revising phases. */
  round?: number;
  /** Maximum critique rounds (always 10). */
  maxRounds?: number;
}

/** Cap on the persisted API trace (serialized), so a long multi-round trace
 * can't bloat the message row. The base64/document bodies are already elided
 * server-side; this guards against a pathological many-round trace. */
const API_TRACE_PERSIST_BUDGET = 200_000;

/** Persist the transparency captures (reasoning text + raw API trace) as
 * attachments on an assistant message, so the panels survive reload. No-ops for
 * whichever capture is empty (i.e. when the setting was off). */
async function persistTransparency(
  messageId: string,
  reasoning: string,
  apiTrace: ApiTraceEntry[],
): Promise<void> {
  if (reasoning.trim()) {
    await addAttachment({
      message_id: messageId,
      kind: "reasoning",
      media_type: "text/plain",
      data: reasoning,
    });
  }
  if (apiTrace.length) {
    const json = JSON.stringify(apiTrace);
    if (json.length <= API_TRACE_PERSIST_BUDGET) {
      await addAttachment({
        message_id: messageId,
        kind: "api_trace",
        media_type: "application/json",
        data: json,
      });
    }
  }
}

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
  /** Planner model: orchestrates complex multi-model tasks. */
  plannerProvider: Provider;
  plannerModel: string;
  /** Whether planner mode is the default for new chats. */
  plannerDefault: boolean;
  /** Whether the current draft (or thread) should use planner orchestration. */
  draftUsePlanner: boolean;
  /** Critic model: reviews plans before execution (null = use planner's). */
  criticProvider: Provider | null;
  /** Critic model id (null = use planner's). */
  criticModel: string | null;
  /** Live planner orchestration progress — per-thread, keyed by thread id.
   *  Drives the PlannerProgress pill strip. Null = planner not active.
   *  Ephemeral (never persisted). */
  threadPlannerProgress: Record<string, PlannerProgress>;
  /** Threads with an active stream (send/regenerate/compact/etc.) — per-thread
   *  so the user can switch between threads while streams run in the background.
   *  Derived `busy` = runningStreams.has(currentThreadId). */
  runningStreams: Set<string>;
  /** Threads whose stream completed while the user was viewing a different
   *  thread. Cleared when the user selects the thread. Drives sidebar indicator. */
  unreadThreads: Set<string>;
  /** Per-thread message cache — saved when switching away from a thread that
   *  has an active stream, restored when switching back, so streaming
   *  placeholders aren't lost. Keyed by thread id. */
  savedMessages: Record<string, MessageView[]>;
  /** Workspace a new (draft) chat will be created in, or null for none. */
  draftWorkspaceId: string | null;
  /** Workspace-file ids excluded from context for the current draft chat (T61).
   * Carries over until the draft is saved; at save time it is persisted to the
   * thread row. Empty array = all selected (default). */
  draftExcludedFileIds: string[];
  /** Incognito draft (T29): the first send creates the thread `ephemeral`. */
  draftIncognito: boolean;
  /** Deep research draft (T55): the first send creates the thread with deep
   * research on. For a saved thread the mode lives on `thread.deep_research`. */
  draftDeepResearch: boolean;
  /** Bot (T38) a new (draft) chat will belong to, or null for none. */
  draftBotId: string | null;
  /** A compaction summarization call is in flight (T28). */
  compacting: boolean;
  /** True between requesting a cancel and the stream actually stopping. */
  cancelling: boolean;
  /** A gated (system-diagnostics) tool call awaiting the user's approval, or
   * null when none is pending. The chat loop blocks until it's resolved. */
  pendingApproval: ApprovalRequestEvent | null;
  /** "Approve all this chat" was chosen — subsequent gated calls in the current
   * send auto-approve without prompting. Reset at the start of each `send`. */
  autoApproveSysTools: boolean;
  /** A tool just finished and we're awaiting the model's follow-up text (the
   * post-tool "thinking" gap). Drives the loading indicator so a slow round
   * after a tool call doesn't look like a hang. Cleared on the next text token
   * and when the stream ends. */
  awaitingModel: boolean;
  /** Estimated tokens of the assembled system context (skills, global/memory,
   * persona, workspace) for the current thread/draft — the part of a request
   * the ContextMeter can't see from `messages` alone. Recomputed when the
   * thread, workspace, or persona changes (T53). */
  systemTokens: number;
  /** A request to load text into the Composer (a quick action's `prefill`).
   * The Composer applies it via render-time sync, keyed by `nonce` so repeated
   * inserts of the same text still fire. null = nothing pending. */
  composerInsert: { text: string; nonce: number } | null;
  /** A request to focus the Composer's input without changing its text
   * (Cmd/Ctrl+L). The Composer focuses on a nonce change; a no-op when no
   * Composer is mounted (e.g. Settings/Usage). null = nothing pending. */
  composerFocus: { nonce: number } | null;
  error: string | null;
  initialized: boolean;
  /** Live streaming placeholder text (null = no active stream). Updated at most
   *  every 100ms during streaming. The messages array is untouched — the
   *  rendering layer augments displayItems with this. */
  streamingContent: string | null;
  streamingToolCalls: MessageToolCall[];
  streamingSubagents: MessageSubagent[];
  streamingImages: MessageImage[];
  streamingReasoning: string;
  streamingApiTrace: ApiTraceEntry[];
  streamingBotId: string | null;
  streamingProvider: Provider | null;
  streamingModel: string | null;

  init: () => Promise<void>;
  refreshThreads: () => Promise<void>;
  selectThread: (id: string) => Promise<void>;
  /** Start a new draft chat; `incognito` makes it session-only (T29). */
  startNewChat: (opts?: { incognito?: boolean }) => void;
  /** Start a new draft chat that will be created inside the given workspace. */
  startNewChatInWorkspace: (workspaceId: string) => void;
  /** Start a new draft chat with a bot (T38). The draft seeds its provider/
   * model from the bot's default when set, else the app default. */
  startNewChatWithBot: (bot: Bot) => void;
  /** Move an existing thread into a workspace (or null to remove it). */
  assignThreadWorkspace: (
    threadId: string,
    workspaceId: string | null,
  ) => Promise<void>;
  /** Set which workspace files are excluded from context for the current
   * thread (or draft). Pass empty array to restore all-selected. Persisted
   * per thread; for a draft it is carried in state until the thread is created
   * on first send (T61). */
  setExcludedFileIds: (excludedIds: string[]) => Promise<void>;
  /** Set provider+model for the current thread, or the draft if none. */
  setProviderModel: (provider: Provider, model: string) => Promise<void>;
  /** Turn deep research mode on/off (T55) for the current thread, or the draft
   * if none. Persisted per thread. */
  setDeepResearch: (on: boolean) => Promise<void>;
  /** Load `text` into the Composer and focus it (a quick action's `prefill`
   * mode). Bumps a nonce so the Composer re-applies even for identical text. */
  insertIntoComposer: (text: string) => void;
  /** Focus the Composer's input without changing its text (Cmd/Ctrl+L). Bumps
   * a nonce so a mounted Composer re-focuses; a no-op when none is mounted. */
  focusComposer: () => void;
  /** Persist the default provider+model for new interactions. */
  setDefaultModel: (provider: Provider, model: string) => Promise<void>;
  /** Persist the planner provider+model. */
  setPlannerModel: (provider: Provider, model: string) => Promise<void>;
  /** Persist whether planner mode is the default for new chats. */
  setPlannerDefault: (on: boolean) => Promise<void>;
  /** Persist the critic provider+model (null = use planner's). */
  setCriticModel: (
    provider: Provider | null,
    model: string | null,
  ) => Promise<void>;
  /** Toggle planner mode on/off for the current thread (or draft). */
  setUsePlanner: (on: boolean) => Promise<void>;
  /** Recompute `systemTokens` for the current thread/draft (skills + global +
   * persona + workspace blocks). Cheap DB/store reads; never throws. */
  refreshSystemTokens: () => Promise<void>;
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
   * Regenerate an assistant reply (T54) as a new variation in its group,
   * optionally steered by a free-text `direction` ("more professional", "less
   * text", …). Re-runs the same provider/model on the history *before* that
   * reply (excluding the group), persists the result as a new variant, and
   * makes it the selected one — so only it counts as context. The other
   * variants are kept for browsing.
   */
  regenerate: (messageId: string, direction: string) => Promise<void>;
  /**
   * Choose which variant of a group is active (T54): the selected variant is
   * the only one sent as context. Browsing the carousel calls this so the
   * shown variation is always the one in context.
   */
  selectVariant: (groupId: string, messageId: string) => Promise<void>;
  /**
   * Request sources for an assistant reply (T56): re-prompts the model with the
   * reply in context and a steering instruction to verify each significant claim
   * using search_web / fetch_url, then add per-claim markdown footnotes with a
   * credibility rating and a supporting quote for each source. Claims that
   * cannot be sourced are flagged explicitly. The result is persisted as a new
   * standalone assistant message appended to the thread (the original is kept).
   */
  requestSources: (messageId: string) => Promise<void>;
  /**
   * Compact the current thread (T28): ask its provider/model to summarize the
   * history since the last compaction point and persist the result as a
   * synthetic `kind: "summary"` row. Non-destructive — all rows are kept;
   * subsequent sends carry [summary + messages after it] (see lib/compaction).
   */
  compact: () => Promise<void>;
  /** Stop the in-flight stream; partial text is persisted via the normal path. */
  cancel: () => Promise<void>;
  /**
   * Resolve the pending system-diagnostics approval (the per-call gate). Denying
   * tells the model the call was declined and the stream continues. `all` (only
   * meaningful when approving) auto-approves the rest of this send's gated calls.
   */
  resolveApproval: (approved: boolean, all?: boolean) => void;
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

/** Parse a stored `workspace_files_excluded` JSON string into a string array.
 * Returns null when the column is NULL/empty (= nothing excluded = all selected).
 * Silently returns null on any parse error (defensive). */
function parseExcludedFileIds(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as string[];
  } catch {
    // Malformed JSON — treat as nothing excluded.
  }
  return null;
}

/**
 * Load the system-context blocks shared by every reply of one send: skills
 * (T15) and the global addendum/memory (T10) in `head`, the workspace context
 * (T20/T58) in `tail`. The persona block (T38/T43) is per-reply and slots
 * between them, so an assembled history reads [skills, global, (bot),
 * workspace, ...history] — the same precedence order the pre-T43 unshift
 * sequence produced: the bot is the assistant's *identity* and spans
 * workspaces, while the workspace context stays closest to the history it
 * scopes. Each provider concatenates consecutive role:"system" messages in
 * array order (Anthropic/Gemini join with "\n\n"; OpenAI/Mistral pass them
 * through), so this realizes the documented precedence without any
 * provider/Rust changes.
 */
async function loadSharedSystemBlocks(
  workspaceId: string | null,
  excludedFileIds?: string[] | null,
): Promise<{ head: ApiMessage[]; tail: ApiMessage[] }> {
  const head: ApiMessage[] = [];
  const tail: ApiMessage[] = [];

  // Enabled skills (T15): instruction packs from `skill` plugins.
  const registry = selectRegistry(usePlugins.getState());
  const skillsSystemText = buildSkillsSystemText(registry.skills);
  if (skillsSystemText)
    head.push({ role: "system", content: skillsSystemText, images: [] });

  // Charts auto-instruct (com.snak.charts): teach the model the ```vega-lite
  // fence when the charts renderer is enabled (empty otherwise).
  const chartsSystemText = buildChartsSystemText(registry);
  if (chartsSystemText)
    head.push({ role: "system", content: chartsSystemText, images: [] });

  // YouTube embeds auto-instruct (com.snak.youtube): tell the model to put video
  // URLs on their own line so the inline player can replace them.
  const youTubeSystemText = buildYouTubeSystemText(registry);
  if (youTubeSystemText)
    head.push({ role: "system", content: youTubeSystemText, images: [] });

  // Artifacts auto-instruct (com.snak.artifacts): teach the model the
  // ```artifact multi-file format when the artifacts renderer is enabled.
  const artifactsSystemText = buildArtifactsSystemText(registry);
  if (artifactsSystemText)
    head.push({ role: "system", content: artifactsSystemText, images: [] });

  // Maps auto-instruct (com.snak.maps): teach the model the ```map GeoJSON fence
  // when the maps renderer is enabled (empty otherwise).
  const mapsSystemText = buildMapsSystemText(registry);
  if (mapsSystemText)
    head.push({ role: "system", content: mapsSystemText, images: [] });

  // Global system context (T10): the custom system-prompt addendum + the
  // user's memory entries (applies to every thread/provider).
  const [addendum, memory] = await Promise.all([
    getSetting(SYSTEM_PROMPT_ADDENDUM_KEY),
    listUserMemory(),
  ]);
  const globalSystemText = buildGlobalSystemText(addendum, memory);
  if (globalSystemText)
    head.push({ role: "system", content: globalSystemText, images: [] });

  // Workspace base context (T20/T58): instructions + reference files, for
  // threads that belong to a workspace. T61: only include files not excluded.
  if (workspaceId) {
    const workspace = await getWorkspace(workspaceId);
    if (workspace) {
      const allFiles = await listWorkspaceFiles(workspaceId);
      const files = filterWorkspaceFiles(allFiles, excludedFileIds);
      const systemText = buildWorkspaceSystemText(workspace, files);
      if (systemText)
        tail.push({ role: "system", content: systemText, images: [] });

      // T62: workspace memory — injected in addition to the global memory
      // block, only when the workspace has memory_enabled = 1.
      if (workspace.memory_enabled) {
        const wsMemory = await listWorkspaceMemory(workspaceId);
        const wsMemoryText = buildWorkspaceMemoryText(wsMemory);
        if (wsMemoryText)
          tail.push({ role: "system", content: wsMemoryText, images: [] });
      }
    }
  }
  return { head, tail };
}

/** The persona's system block — identity header, T40 profile fields, mood,
 * and memory — or null when it all renders empty. Loaded per reply, so each
 * @-mentioned persona (T43) gets its own current memory/mood. */
async function botSystemBlock(bot: Bot): Promise<ApiMessage | null> {
  const botText = buildBotSystemText(bot, await listBotMemory(bot.id));
  return botText ? { role: "system", content: botText, images: [] } : null;
}

/**
 * The provider+model a reply runs on (T43 "multi-LLM mode"): an @-mentioned
 * persona answers on its OWN default provider/model when both are set and that
 * provider has a stored key (keyless providers always qualify) — otherwise it
 * falls back to the thread's model. The key check (cached `useKeys` presence,
 * never a keychain read) keeps a persona pointed at a provider with no key from
 * erroring the send; it just uses the thread model instead.
 */
function resolveReplyModel(
  bot: Bot | null,
  threadProvider: Provider,
  threadModel: string,
  hasKey: (p: Provider) => boolean,
): { provider: Provider; model: string } {
  if (
    bot &&
    bot.default_provider &&
    bot.default_model &&
    hasKey(bot.default_provider)
  ) {
    return { provider: bot.default_provider, model: bot.default_model };
  }
  return { provider: threadProvider, model: threadModel };
}

/**
 * Display names of the OTHER participants in the thread from `selfBotId`'s point
 * of view — other personas (by `roster` name) plus "Assistant" when the base
 * assistant has spoken. Feeds `buildGroupChatSystemText`'s roster line.
 */
function groupParticipantNames(
  rows: readonly MessageView[],
  selfBotId: string | null,
  roster: Record<string, string>,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  let sawBase = false;
  for (const m of rows) {
    if (m.role !== "assistant") continue;
    const author = m.bot_id ?? null;
    if (author === selfBotId) continue;
    if (author == null) {
      sawBase = true;
      continue;
    }
    if (!seen.has(author)) {
      seen.add(author);
      names.push(roster[author] ?? "Assistant");
    }
  }
  // The reader is a persona and the base assistant has spoken → name it too.
  if (sawBase && selfBotId != null) names.push("Assistant");
  return names;
}

export const useThreads = create<ThreadsState>((set, get) => ({
  threads: [],
  currentThreadId: null,
  messages: [],
  draftProvider: PROVIDERS[0].id,
  draftModel: PROVIDERS[0].defaultModel,
  defaultProvider: PROVIDERS[0].id,
  defaultModel: PROVIDERS[0].defaultModel,
  plannerProvider: PROVIDERS[0].id,
  plannerModel: PROVIDERS[0].defaultModel,
  plannerDefault: false,
  draftUsePlanner: false,
  criticProvider: null,
  criticModel: null,
  threadPlannerProgress: {},
  runningStreams: new Set(),
  unreadThreads: new Set(),
  savedMessages: {},
  draftWorkspaceId: null,
  draftExcludedFileIds: [],
  draftIncognito: false,
  draftDeepResearch: false,
  draftBotId: null,
  compacting: false,
  cancelling: false,
  pendingApproval: null,
  autoApproveSysTools: false,
  awaitingModel: false,
  systemTokens: 0,
  composerInsert: null,
  composerFocus: null,
  error: null,
  initialized: false,
  streamingContent: null,
  streamingToolCalls: [],
  streamingSubagents: [],
  streamingImages: [],
  streamingReasoning: "",
  streamingApiTrace: [],
  streamingBotId: null,
  streamingProvider: null,
  streamingModel: null,

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
    // Load planner settings.
    const [pp, pm, pdRaw] = await Promise.all([
      getSetting(PLANNER_PROVIDER_KEY),
      getSetting(PLANNER_MODEL_KEY),
      getSetting(PLANNER_DEFAULT_KEY),
    ]);
    const plannerDef = resolveDefault(pp, pm);
    const plannerDefault = pdRaw === "1";
    // Load critic settings (null = fall back to planner model).
    const [cp, cm] = await Promise.all([
      getSetting(CRITIC_PROVIDER_KEY),
      getSetting(CRITIC_MODEL_KEY),
    ]);
    const criticProvider = (cp as Provider | null) ?? null;
    const criticModel = cm ?? null;
    set({
      defaultProvider: def.provider,
      defaultModel: def.model,
      draftProvider: def.provider,
      draftModel: def.model,
      plannerProvider: plannerDef.provider,
      plannerModel: plannerDef.model,
      plannerDefault,
      draftUsePlanner: plannerDefault,
      criticProvider,
      criticModel,
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
    const oldId = get().currentThreadId;
    // Save the current thread's messages before switching away, so streaming
    // placeholders are preserved if we switch back while a stream is active.
    if (oldId && oldId !== id) {
      set((s) => ({
        savedMessages: { ...s.savedMessages, [oldId]: s.messages },
      }));
    }
    // Clear any streaming state from the previous thread — the bubble
    // lives in store fields now, not inside messages[].
    set({
      streamingContent: null,
      streamingToolCalls: [],
      streamingSubagents: [],
      streamingImages: [],
      streamingReasoning: "",
      streamingApiTrace: [],
      streamingBotId: null,
      streamingProvider: null,
      streamingModel: null,
    });
    // Restore from saved cache if available (e.g. the thread had an active
    // stream and its messages were saved when we switched away), otherwise
    // load fresh from the DB.
    const saved = get().savedMessages[id];
    const messages = saved ?? (await loadThreadMessages(id));
    // Clear the unread flag for this thread — the user is now viewing it.
    set((s) => {
      const unread = new Set(s.unreadThreads);
      unread.delete(id);
      return { currentThreadId: id, messages, unreadThreads: unread, error: null };
    });
    const thread = get().threads.find((t) => t.id === id);
    // Tabs metaphor: opening an archived chat promotes it back to open.
    if (thread?.archived) {
      await setThreadArchived(id, false);
      await get().refreshThreads();
    }
    // Incognito threads are never remembered as last_thread_id (T29) — the
    // startup purge would have deleted them before restore anyway.
    if (shouldRememberThread(thread)) await setSetting(LAST_THREAD_KEY, id);
    void get().refreshSystemTokens();
  },

  startNewChat: (opts) => {
    const usePlanner = get().plannerDefault;
    set({
      currentThreadId: null,
      messages: [],
      error: null,
      draftWorkspaceId: null,
      draftExcludedFileIds: [],
      draftIncognito: opts?.incognito ?? false,
      draftDeepResearch: false,
      draftBotId: null,
      draftProvider: get().defaultProvider,
      draftModel: get().defaultModel,
      draftUsePlanner: usePlanner,
    });
    void get().refreshSystemTokens();
    // Move focus to the Composer so the user can start typing immediately,
    // reusing the same seam as the Cmd/Ctrl+L shortcut (T64).
    get().focusComposer();
  },

  startNewChatInWorkspace: (workspaceId) => {
    const usePlanner = get().plannerDefault;
    set({
      currentThreadId: null,
      messages: [],
      error: null,
      draftWorkspaceId: workspaceId,
      draftExcludedFileIds: [],
      draftIncognito: false,
      draftDeepResearch: false,
      draftBotId: null,
      draftProvider: get().defaultProvider,
      draftModel: get().defaultModel,
      draftUsePlanner: usePlanner,
    });
    void get().refreshSystemTokens();
    // Move focus to the Composer so the user can start typing immediately (T64).
    get().focusComposer();
  },

  startNewChatWithBot: (bot) => {
    // The bot's default provider+model is only used when BOTH are set (the DB
    // helper enforces both-or-neither, but stay defensive); otherwise the
    // draft starts on the app default, like any new chat.
    const hasDefault =
      bot.default_provider !== null && bot.default_model !== null;
    const usePlanner = get().plannerDefault;
    set({
      currentThreadId: null,
      messages: [],
      error: null,
      draftWorkspaceId: null,
      draftExcludedFileIds: [],
      draftIncognito: false,
      draftDeepResearch: false,
      draftBotId: bot.id,
      draftProvider: hasDefault ? bot.default_provider! : get().defaultProvider,
      draftModel: hasDefault ? bot.default_model! : get().defaultModel,
      draftUsePlanner: usePlanner,
    });
    void get().refreshSystemTokens();
    // Move focus to the Composer so the user can start typing immediately (T64).
    get().focusComposer();
  },

  assignThreadWorkspace: async (threadId, workspaceId) => {
    await setThreadWorkspace(threadId, workspaceId);
    await get().refreshThreads();
    void get().refreshSystemTokens();
  },

  setExcludedFileIds: async (excludedIds) => {
    const id = get().currentThreadId;
    if (id) {
      // Saved thread: persist immediately.
      await setThreadWorkspaceFilesExcluded(id, excludedIds);
      await get().refreshThreads();
    } else {
      // Draft thread: carry in state; persisted at thread-creation time.
      set({ draftExcludedFileIds: excludedIds });
    }
    void get().refreshSystemTokens();
  },

  setProviderModel: async (provider, model) => {
    const id = get().currentThreadId;
    if (!id) {
      // Selecting a direct model turns planner off for the draft.
      set({ draftProvider: provider, draftModel: model, draftUsePlanner: false });
      return;
    }
    const thread = get().threads.find((t) => t.id === id);
    // If planner is active, restore the pre-planner model first so switching
    // to a direct model doesn't leave stale pre-planner state behind.
    if (thread && thread.planner_active) {
      await restoreThreadPrePlannerModel(id);
      await setThreadPlannerActive(id, false);
    }
    await setThreadProviderModel(id, provider, model);
    await get().refreshThreads();
  },

  setDeepResearch: async (on) => {
    const id = get().currentThreadId;
    if (!id) {
      set({ draftDeepResearch: on });
      return;
    }
    await setThreadDeepResearch(id, on);
    await get().refreshThreads();
  },

  insertIntoComposer: (text) => {
    set({
      composerInsert: { text, nonce: (get().composerInsert?.nonce ?? 0) + 1 },
    });
  },

  focusComposer: () => {
    set({ composerFocus: { nonce: (get().composerFocus?.nonce ?? 0) + 1 } });
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

  setPlannerModel: async (provider, model) => {
    await setSetting(PLANNER_PROVIDER_KEY, provider);
    await setSetting(PLANNER_MODEL_KEY, model);
    set({ plannerProvider: provider, plannerModel: model });
  },

  setPlannerDefault: async (on) => {
    await setSetting(PLANNER_DEFAULT_KEY, on ? "1" : "0");
    set({ plannerDefault: on });
  },

  setCriticModel: async (provider, model) => {
    if (provider !== null && model !== null) {
      await setSetting(CRITIC_PROVIDER_KEY, provider);
      await setSetting(CRITIC_MODEL_KEY, model);
    } else {
      await setSetting(CRITIC_PROVIDER_KEY, "");
      await setSetting(CRITIC_MODEL_KEY, "");
    }
    set({ criticProvider: provider ?? null, criticModel: model ?? null });
  },

  setUsePlanner: async (on) => {
    const id = get().currentThreadId;
    if (!id) {
      // Draft: just toggle the flag. The draft provider/model stay as-is;
      // the planner model is used at send time when draftUsePlanner is true.
      set({ draftUsePlanner: on });
      return;
    }
    // Saved thread: persist the planner flag and save/restore pre-planner model.
    const thread = get().threads.find((t) => t.id === id);
    if (!thread) return;
    if (on) {
      // Save the current provider/model so we can restore when toggling off.
      await setThreadPlannerActive(id, true, thread.provider, thread.model);
      // Swap thread to use the planner model.
      const { plannerProvider, plannerModel } = get();
      await setThreadProviderModel(id, plannerProvider, plannerModel);
    } else {
      // Restore the pre-planner provider/model.
      await restoreThreadPrePlannerModel(id);
      await setThreadPlannerActive(id, false);
    }
    await get().refreshThreads();
    // Reload messages so the UI reflects the updated thread.
    if (id === get().currentThreadId) {
      set({ messages: await loadThreadMessages(id) });
    }
  },

  refreshSystemTokens: async () => {
    try {
      const id = get().currentThreadId;
      let workspaceId: string | null;
      let botId: string | null;
      let excludedFileIds: string[] | null;
      if (id) {
        const thread = get().threads.find((x) => x.id === id);
        workspaceId = thread?.workspace_id ?? null;
        botId = thread?.bot_id ?? null;
        excludedFileIds = parseExcludedFileIds(
          thread?.workspace_files_excluded,
        );
      } else {
        workspaceId = get().draftWorkspaceId;
        botId = get().draftBotId;
        excludedFileIds = get().draftExcludedFileIds;
      }
      // Reuse the exact builders send() uses, so the estimate tracks the real
      // request: skills + global/memory (head), persona (bot), workspace (tail).
      const shared = await loadSharedSystemBlocks(workspaceId, excludedFileIds);
      const bot = botId ? await getBot(botId) : null;
      const botBlock = bot ? await botSystemBlock(bot) : null;
      const blocks = [
        ...shared.head,
        ...(botBlock ? [botBlock] : []),
        ...shared.tail,
      ];
      const total = blocks.reduce((n, b) => n + estimateTokens(b.content), 0);
      set({ systemTokens: total });
    } catch {
      // Estimate-only — a failed DB/store read must never disrupt the UI.
    }
  },

  send: async (content, images, documents = []) => {
    // Ignore empty/whitespace-only sends with no attachments.
    if (!content.trim() && images.length === 0 && documents.length === 0)
      return;
    // Per-thread busy gate: block a send only when this thread already has
    // an active stream (a different thread's stream does not block this one).
    {
      const tid = get().currentThreadId;
      if (tid && get().runningStreams.has(tid)) return;
    }

    // Offline backstop: a cloud provider can't be reached. The Composer already
    // blocks this in the UI, but the QuickInput overlay submits straight through
    // send() (App's `quick-submit` handler), bypassing that gate — so enforce it
    // here too. The keyless local provider (Ollama) is never blocked. Done before
    // any thread/message is persisted so a blocked send leaves no junk thread.
    {
      const cid = get().currentThreadId;
      const effProvider = cid
        ? (get().threads.find((x) => x.id === cid)?.provider ??
          get().draftProvider)
        : get().draftProvider;
      const { status, forceOffline } = useConnectivity.getState();
      if (
        !isKeylessProvider(effProvider) &&
        deriveOffline(status, forceOffline)
      ) {
        const label =
          PROVIDERS.find((p) => p.id === effProvider)?.label ?? effProvider;
        set({ error: t("composer.offline", { provider: label }) });
        return;
      }
    }

    // runningId is captured before try so the finally block can remove this
    // thread from runningStreams regardless of which thread is currently viewed.
    let runningId: string | null = null;
    try {
      let id = get().currentThreadId;
      let provider: Provider;
      let model: string;
      let workspaceId: string | null;
      let botId: string | null;
      let ephemeral: boolean;
      let deepResearch: boolean;
      let excludedFileIds: string[] | null;

      if (!id) {
        const usePlanner = get().draftUsePlanner;
        provider = get().draftProvider;
        model = get().draftModel;
        workspaceId = get().draftWorkspaceId;
        botId = get().draftBotId;
        ephemeral = get().draftIncognito;
        deepResearch = get().draftDeepResearch;
        excludedFileIds =
          get().draftExcludedFileIds.length > 0
            ? get().draftExcludedFileIds
            : null;
        const thread = await createThread({
          provider,
          model,
          // Attachment-only sends title from the first document's name, or
          // the localized "Image" fallback (mirrors the image-only case).
          title: deriveTitle(
            content || documents[0]?.name || t("thread.image"),
            t("thread.newChat"),
          ),
          workspaceId,
          ephemeral,
          botId,
        });
        id = thread.id;
        // Persist planner state on the new thread so the ModelPicker reflects it
        // and subsequent sends run the planner without relying on draftUsePlanner.
        if (usePlanner) {
          await setThreadPlannerActive(id, true, provider, model);
          await setThreadProviderModel(
            id,
            get().plannerProvider,
            get().plannerModel,
          );
        }
        // Carry the draft's deep-research mode onto the new thread row (T55) so
        // it persists like incognito/workspace do.
        if (deepResearch) await setThreadDeepResearch(id, true);
        // Carry the draft's excluded file ids onto the new thread row (T61).
        if (excludedFileIds && excludedFileIds.length > 0) {
          await setThreadWorkspaceFilesExcluded(id, excludedFileIds);
        }
        // Incognito threads never become last_thread_id (T29).
        if (!ephemeral) await setSetting(LAST_THREAD_KEY, id);
        await get().refreshThreads();
        // Set currentThreadId after refreshThreads so ModelPicker sees the
        // thread with correct data immediately — no flash of fallback draft values.
        set({ currentThreadId: id, draftUsePlanner: false });
      } else {
        const t = get().threads.find((x) => x.id === id)!;
        provider = t.provider;
        model = t.model;
        workspaceId = t.workspace_id;
        botId = t.bot_id;
        ephemeral = t.ephemeral !== 0;
        deepResearch = t.deep_research !== 0;
        excludedFileIds = parseExcludedFileIds(t.workspace_files_excluded);
      }

      runningId = id;
      set((s) => ({
        runningStreams: new Set([...s.runningStreams, id]),
        cancelling: false,
        pendingApproval: null,
        autoApproveSysTools: false,
        awaitingModel: true,
        error: null,
      }));

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

      // @-mentions (T43): personas called out in the message each produce
      // their own one-shot, in-character reply. The roster comes from lib/db
      // directly — NOT useBots: store/bots.ts imports this store, so reading
      // it here would create a module cycle.
      const allBots = await listBots();
      const mentioned = content.includes("@")
        ? extractMentions(content, allBots)
        : [];
      // bot_id → name, for labeling other speakers in a group thread (T43).
      const roster: Record<string, string> = {};
      for (const b of allBots) roster[b.id] = b.name;
      // Cached key presence (no keychain read) for per-persona model resolution.
      const keyed = useKeys.getState().present;
      const hasKey = (p: Provider) => isKeylessProvider(p) || keyed.has(p);
      // Providers usable for plan step dispatch (has key or is keyless).
      const keyedProviders = new Set(PROVIDERS.map((p) => p.id).filter(hasKey));

      // System context shared by every reply of this send (skills/global/
      // workspace); the persona block is per-reply and slots in between.
      const shared = await loadSharedSystemBlocks(workspaceId, excludedFileIds);
      const threadId = id; // non-null capture for the closures below

      // Planner mode: the planner model orchestrates the response instead of
      // sending directly to a single model. Skip @-mentions — the planner
      // itself can decide to delegate to different models.
      const threadPlannerActive =
        (get().threads.find((t) => t.id === threadId)?.planner_active ?? 0) !==
        0;
      const usePlanner = threadPlannerActive;

      const runPlannerOrchestration = async (
        tid: string,
        rows: MessageView[],
        sysBlocks: { head: ApiMessage[]; tail: ApiMessage[] },
      ) => {
        const { plannerProvider, plannerModel } = get();
        const allModels = useModels.getState().models;
        const plannerInstructions =
          (await getSetting("planner_instructions")) ?? undefined;
        const plannerPrompt = buildPlannerSystemPrompt(
          allModels,
          PROVIDERS,
          plannerInstructions,
        );

        // Build API history: planner system prompt first, then shared context,
        // then the conversation history.
        const history: ApiMessage[] = [
          { role: "system", content: plannerPrompt, images: [] },
          ...sysBlocks.head,
          ...sysBlocks.tail,
          ...compactHistory(
            rows,
            { selfBotId: null, roster: {}, baseLabel: "Assistant" },
            hasRenderer(selectRegistry(usePlugins.getState()), "youtube"),
          ),
        ];

        // Show the planning phase pill immediately.
        set((s) => ({
          threadPlannerProgress: { ...s.threadPlannerProgress, [tid]: { phase: "planning", steps: [] } },
        }));

        // Use the global streaming state fields — they hold the planner's live
        // output during the planning phase.
        let plannerAcc = "";
        const plannerToolCalls: MessageToolCall[] = [];
        const plannerSubagents: MessageSubagent[] = [];
        let plannerReasoning = "";
        const plannerApiTrace: ApiTraceEntry[] = [];
        let plannerLastFlush = 0;
        const plannerFlush = () => {
          if (get().currentThreadId !== tid) return;
          set({
            streamingContent: plannerAcc,
            streamingToolCalls: [...plannerToolCalls],
            streamingSubagents: [...plannerSubagents],
            streamingReasoning: plannerReasoning,
            streamingApiTrace: [...plannerApiTrace],
            streamingProvider: plannerProvider,
            streamingModel: plannerModel,
            ...(isModelOutput({ text: plannerAcc } as StreamEvent) ? { awaitingModel: false } : {}),
          });
        };
        set({
          streamingContent: "",
          streamingToolCalls: [],
          streamingSubagents: [],
          streamingImages: [],
          streamingReasoning: "",
          streamingApiTrace: [],
          streamingBotId: null,
          streamingProvider: plannerProvider,
          streamingModel: plannerModel,
        });
        const onDelta = (event: StreamEvent) => {
          applyToolEvent(event, plannerToolCalls);
          applySubagentEvent(event, plannerSubagents);
          applyTraceEvent(event, plannerApiTrace);
          if (event.reasoning) plannerReasoning += event.reasoning.text;
          if (event.text) plannerAcc += event.text;
          const now = performance.now();
          if (now - plannerLastFlush > 100) {
            plannerLastFlush = now;
            plannerFlush();
          }
        };

        const started = Date.now();
        const plannerResult = await chatStream(
          plannerProvider,
          plannerModel,
          history,
          onDelta,
          tid,
          false,
          true,
        );
        plannerFlush();

        // Persist planner message.
        if (
          plannerResult.content.length > 0 ||
          plannerToolCalls.length > 0 ||
          plannerSubagents.length > 0
        ) {
          // Parse plan with model validation. Do this before persistence so we
          // can strip the raw JSON fence from the displayed message content.
          const parseResult = parsePlan(plannerResult.content, allModels, PROVIDERS, keyedProviders);
          let plan = parseResult?.plan ?? null;

          // Strip the JSON fence from the planner output so the raw JSON isn't
          // displayed redundantly alongside the structured PlanPanel.
          const displayContent = stripPlanJsonFence(plannerResult.content);

          const plannerMsg = await addMessage({
            thread_id: tid,
            role: "assistant",
            content: displayContent,
            duration_ms: Math.round(Date.now() - started),
            provider: plannerProvider,
            model: plannerModel,
          });
          // Persist tool calls, subagents, transparency.
          await Promise.all([
            ...plannerToolCalls.map((tc) =>
              addAttachment({
                message_id: plannerMsg.id,
                kind: "tool_call",
                media_type: "application/json",
                data: JSON.stringify(persistableToolCall(tc)),
              }),
            ),
            ...plannerSubagents.map((s) =>
              addAttachment({
                message_id: plannerMsg.id,
                kind: "subagent",
                media_type: "application/json",
                data: JSON.stringify(persistableSubagent(s)),
              }),
            ),
            persistTransparency(plannerMsg.id, plannerReasoning, plannerApiTrace),
          ]);
          // Record usage.
          const u = plannerResult.usage;
          if (
            u &&
            (u.input_tokens > 0 ||
              u.output_tokens > 0 ||
              u.cache_creation_tokens > 0 ||
              u.cache_read_tokens > 0)
          ) {
            await addUsage({
              message_id: plannerMsg.id,
              thread_id: tid,
              provider: plannerProvider,
              model: plannerResult.model || plannerModel,
              input_tokens: u.input_tokens,
              output_tokens: u.output_tokens,
              cache_creation_tokens: u.cache_creation_tokens,
              cache_read_tokens: u.cache_read_tokens,
            });
          }

          // Post any model corrections as a note.
          if (parseResult && parseResult.warnings.length > 0) {
            await get().postNote(
              `Model corrections in plan:\n${parseResult.warnings.map((w) => `- ${w}`).join("\n")}`,
            );
          }

          if (plan && (plan.strategy === "route" || plan.strategy === "multi_step")) {
            // Helper: stream a model response into the STREAM_ID placeholder,
            // persist it, and reload messages so the UI shows the real row.
            const writeReply = async (
              provider: Provider,
              model: string,
              messages: ApiMessage[],
            ): Promise<{
              content: string;
              model: string;
              usage: { input_tokens: number; output_tokens: number; cache_creation_tokens: number; cache_read_tokens: number };
              msgId: string;
            }> => {
              let acc = "";
              let wLastFlush = 0;
              const wFlush = () => {
                if (get().currentThreadId !== tid) return;
                set({
                  streamingContent: acc,
                  streamingProvider: provider,
                  streamingModel: model,
                });
              };
              set({
                streamingContent: "",
                streamingToolCalls: [],
                streamingSubagents: [],
                streamingImages: [],
                streamingReasoning: "",
                streamingApiTrace: [],
                streamingBotId: null,
                streamingProvider: provider,
                streamingModel: model,
              });
              const onDelta = (event: StreamEvent) => {
                if (event.text) acc += event.text;
                const now = performance.now();
                if (now - wLastFlush > 100) {
                  wLastFlush = now;
                  wFlush();
                }
              };
              const result = await chatStream(provider, model, messages, onDelta, tid, false);
              wFlush();
              if (result.content.length > 0) {
                const msg = await addMessage({
                  thread_id: tid, role: "assistant", content: result.content,
                  provider, model,
                });
                set({
                  streamingContent: null,
                  streamingToolCalls: [],
                  streamingSubagents: [],
                  streamingImages: [],
                  streamingReasoning: "",
                  streamingApiTrace: [],
                  streamingBotId: null,
                  streamingProvider: null,
                  streamingModel: null,
                });
                {
                  const msgs = await loadThreadMessages(tid);
                  if (get().currentThreadId === tid) set({ messages: msgs });
                }
                return { ...result, msgId: msg.id };
              }
              set({
                streamingContent: null,
                streamingToolCalls: [],
                streamingSubagents: [],
                streamingImages: [],
                streamingReasoning: "",
                streamingApiTrace: [],
                streamingBotId: null,
                streamingProvider: null,
                streamingModel: null,
              });
              {
                const msgs = await loadThreadMessages(tid);
                if (get().currentThreadId === tid) set({ messages: msgs });
              }
              return { ...result, msgId: "" };
            };

            // Save initial plan attachment.
            await addAttachment({
              message_id: plannerMsg.id,
              kind: "plan",
              media_type: "application/json",
              data: JSON.stringify(plan),
            });
            set({
              streamingContent: null,
              streamingToolCalls: [],
              streamingSubagents: [],
              streamingImages: [],
              streamingReasoning: "",
              streamingApiTrace: [],
              streamingBotId: null,
              streamingProvider: null,
              streamingModel: null,
            });
            {
              const msgs = await loadThreadMessages(tid);
              if (get().currentThreadId === tid) set({ messages: msgs });
            }

            // Critique loop — up to 10 rounds.
            const MAX_ROUNDS = 10;
            let approved = false;
            let round: number;
            const { criticProvider: cProvider, criticModel: cModel } = get();
            const criticProvider = (cProvider ?? plannerProvider) as Provider;
            const criticModel = cModel ?? plannerModel;

            for (round = 1; round <= MAX_ROUNDS; round++) {
              if (get().cancelling) break;

              // Critique phase.
              set((s) => ({
                threadPlannerProgress: {
                  ...s.threadPlannerProgress,
                  [tid]: { phase: "critiquing", steps: [], round, maxRounds: MAX_ROUNDS },
                },
              }));

              const criticMessages: ApiMessage[] = [
                { role: "system", content: buildCriticSystemPrompt(), images: [] },
                { role: "user", content: buildCriticRequest(content, plan!), images: [] },
              ];
              const criticResult = await writeReply(criticProvider, criticModel, criticMessages);
              const criticVerdict = parseCriticResponse(criticResult.content);

              if (criticVerdict?.approved) {
                approved = true;
                break;
              }

              if (round === MAX_ROUNDS) break;

              // Re-planning phase.
              set((s) => ({
                threadPlannerProgress: {
                  ...s.threadPlannerProgress,
                  [tid]: { phase: "revising", steps: [], round: round + 1, maxRounds: MAX_ROUNDS },
                },
              }));

              const issues = criticVerdict
                ? criticVerdict.issues.join("\n")
                : "The plan has issues that need to be addressed.";
              const replanHistory: ApiMessage[] = [
                { role: "system", content: plannerPrompt, images: [] },
                ...sysBlocks.head,
                ...sysBlocks.tail,
                ...compactHistory(
                  rows,
                  { selfBotId: null, roster: {}, baseLabel: "Assistant" },
                  hasRenderer(selectRegistry(usePlugins.getState()), "youtube"),
                ),
                { role: "assistant", content: `Previous plan:\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``, images: [] },
                { role: "user", content: `Critique:\n${issues}\n\nPlease revise the plan to address these issues. Only use model IDs exactly as listed in the available models.`, images: [] },
              ];
              const revisedResult = await writeReply(plannerProvider, plannerModel, replanHistory);
              const revisedParse = parsePlan(revisedResult.content, allModels, PROVIDERS, keyedProviders);
              if (!revisedParse) continue; // Couldn't parse the revision — try again.
              plan = revisedParse.plan;

              // Save revised plan attachment on the revision message.
              if (revisedResult.msgId) {
                await addAttachment({
                  message_id: revisedResult.msgId,
                  kind: "plan",
                  media_type: "application/json",
                  data: JSON.stringify(plan),
                });
                set({
                  streamingContent: null,
                  streamingToolCalls: [],
                  streamingSubagents: [],
                  streamingImages: [],
                  streamingReasoning: "",
                  streamingApiTrace: [],
                  streamingBotId: null,
                  streamingProvider: null,
                  streamingModel: null,
                });
                {
                  const msgs = await loadThreadMessages(tid);
                  if (get().currentThreadId === tid) set({ messages: msgs });
                }
              }

              if (revisedParse.warnings.length > 0) {
                await get().postNote(
                  `Model corrections in revised plan:\n${revisedParse.warnings.map((w) => `- ${w}`).join("\n")}`,
                );
              }
            }

            if (!approved) {
              // Max rounds reached — fall back to direct answer.
              await get().postNote(
                `Planner reached maximum critique rounds (${MAX_ROUNDS}). Answering directly.`,
              );
              set((s) => ({
                threadPlannerProgress: {
                  ...s.threadPlannerProgress,
                  [tid]: {
                    phase: "completing",
                    steps: [],
                    directModel: `${plannerProvider}:${plannerModel}`,
                  },
                },
              }));
            } else {
              // Plan approved — dispatch steps.
              const steps: StepProgress[] = plan!.steps.map((s) => ({
                id: s.id,
                description: s.description,
                provider: s.provider,
                model: s.model,
                status: "pending" as const,
              }));
              set((s) => ({
                threadPlannerProgress: {
                  ...s.threadPlannerProgress,
                  [tid]: {
                    phase: "dispatching",
                    steps,
                  },
                },
              }));

              // Execute steps in dependency waves via Promise.all (cloud models
              // run unrestricted; local/Ollama steps serialize through a gate).
              const stepResults = new Map<string, string>();
              const gate = createGate();

              const runStep = async (step: PlanStep, resolvedPrompt: string) => {
                if (get().cancelling)
                  return { stepId: step.id, description: step.description, provider: step.provider, model: step.model, content: "", usage: { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 } };

                // Mark step as running.
                set((s) => {
                  const pp = s.threadPlannerProgress[tid];
                  if (!pp) return {};
                  return {
                    threadPlannerProgress: {
                      ...s.threadPlannerProgress,
                      [tid]: {
                        ...pp,
                        phase: "executing" as const,
                        steps: pp.steps.map((sp) =>
                          sp.id === step.id ? { ...sp, status: "running" as const } : sp,
                        ),
                      },
                    },
                  };
                });

                // No streaming bubble for steps — the planner progress strip
                // already shows live status. Content surfaces after DB reload.
                const noopOnDelta = (_event: StreamEvent) => {};

                const stepStarted = Date.now();
                const stepResult = await gate(
                  isKeylessProvider(step.provider),
                  () =>
                    chatStream(
                      step.provider,
                      step.model,
                      [{ role: "user", content: resolvedPrompt, images: [] }],
                      noopOnDelta,
                      tid,
                      false,
                    ),
                );

                if (stepResult.content.length > 0) {
                  const stepMsg = await addMessage({
                    thread_id: tid,
                    role: "assistant",
                    content: stepResult.content,
                    duration_ms: Math.round(Date.now() - stepStarted),
                    provider: step.provider,
                    model: step.model,
                  });
                  stepResults.set(step.id, stepResult.content);
                  // Record usage for this step.
                  const su = stepResult.usage;
                  if (
                    su &&
                    (su.input_tokens > 0 ||
                      su.output_tokens > 0 ||
                      su.cache_creation_tokens > 0 ||
                      su.cache_read_tokens > 0)
                  ) {
                    await addUsage({
                      message_id: stepMsg.id,
                      thread_id: tid,
                      provider: step.provider,
                      model: stepResult.model || step.model,
                      input_tokens: su.input_tokens,
                      output_tokens: su.output_tokens,
                      cache_creation_tokens: su.cache_creation_tokens,
                      cache_read_tokens: su.cache_read_tokens,
                    });
                  }
                }

                // Mark step as done.
                set((s) => {
                  const pp = s.threadPlannerProgress[tid];
                  if (!pp) return {};
                  return {
                    threadPlannerProgress: {
                      ...s.threadPlannerProgress,
                      [tid]: {
                        ...pp,
                        steps: pp.steps.map((sp) =>
                          sp.id === step.id ? { ...sp, status: "done" as const } : sp,
                        ),
                      },
                    },
                  };
                });

                return {
                  stepId: step.id,
                  description: step.description,
                  provider: step.provider,
                  model: step.model,
                  content: stepResult.content,
                  usage: stepResult.usage ?? { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 },
                };
              };

              // Run waves. The last wave gets the "completing" phase.
              const waves = topologicalSort(plan!.steps);
              for (let wi = 0; wi < waves.length; wi++) {
                if (get().cancelling) break;
                if (wi === waves.length - 1) {
                  set((s) => {
                    const pp = s.threadPlannerProgress[tid];
                    if (!pp) return {};
                    return {
                      threadPlannerProgress: {
                        ...s.threadPlannerProgress,
                        [tid]: { ...pp, phase: "completing" },
                      },
                    };
                  });
                }
                await Promise.all(
                  waves[wi].map((step) =>
                    runStep(step, resolveStepVariables(step.prompt, stepResults)),
                  ),
                );
              }
            }
          } else if (plan?.strategy === "direct") {
            // Direct strategy: show which model was chosen (or "answered directly").
            const directModel =
              plan.steps.length === 1
                ? `${plan.steps[0].provider}:${plan.steps[0].model}`
                : undefined;
            set((s) => ({
              threadPlannerProgress: {
                ...s.threadPlannerProgress,
                [tid]: {
                  phase: "completing",
                  steps: [],
                  directModel,
                },
              },
            }));
          }

          // Reload messages to replace all placeholders and show final state.
          // Clear planner progress — orchestration is complete.
          set({
            streamingContent: null,
            streamingToolCalls: [],
            streamingSubagents: [],
            streamingImages: [],
            streamingReasoning: "",
            streamingApiTrace: [],
            streamingBotId: null,
            streamingProvider: null,
            streamingModel: null,
          });
          {
            const msgs = await loadThreadMessages(tid);
            if (get().currentThreadId === tid) {
              set((s) => {
                const updated = { ...s.threadPlannerProgress };
                delete updated[tid];
                return { messages: msgs, threadPlannerProgress: updated };
              });
            } else {
              set((s) => {
                const updated = { ...s.threadPlannerProgress };
                delete updated[tid];
                return { savedMessages: { ...s.savedMessages, [tid]: msgs }, threadPlannerProgress: updated };
              });
            }
          }
          await get().refreshThreads();
        }
      };

      if (usePlanner && !deepResearch) {
        await runPlannerOrchestration(threadId, afterUser, shared);
        return; // planner handled everything — skip normal reply path
      }

      /**
       * Stream one assistant reply and persist it (+ tool calls, usage).
       * `replyBot`'s persona block occupies the "bot" slot of the precedence
       * stack; `attributeBotId` lands in `messages.bot_id` (T43) — set for an
       * @-mentioned persona, null for the thread's own persona, whose replies
       * render off the thread's bot instead.
       */
      const runReply = async (
        replyBot: Bot | null,
        attributeBotId: string | null,
      ) => {
        // Compacted API history (T28): everything after the latest `summary`
        // row, with that summary injected as a leading user turn — or the
        // full transcript when never compacted. Reloaded per reply so, on a
        // multi-mention send, persona N sees personas 1..N-1's replies in
        // history (they can react to each other — by design).
        const rows = await loadThreadMessages(threadId);
        const botBlock = replyBot ? await botSystemBlock(replyBot) : null;
        // Per-persona model (T43 multi-LLM): a mentioned persona answers on its
        // own provider/model when set; the thread persona / base reply uses the
        // thread's model.
        const { provider: replyProvider, model: replyModel } =
          resolveReplyModel(replyBot, provider, model, hasKey);
        // Group labeling (T43): label the other speakers and, for a persona
        // reply, prepend a framing block right after its own block explaining
        // the group format. compactHistory always gets the group so even a base
        // reply sees labeled persona turns; the framing block needs a persona
        // identity, so it only attaches when replyBot is set and labeling fires.
        const group: GroupContext = {
          selfBotId: attributeBotId,
          roster,
          baseLabel: "Assistant",
        };
        const groupBlock: ApiMessage | null =
          replyBot && groupLabelingActive(rows, group)
            ? {
                role: "system",
                content: buildGroupChatSystemText({
                  selfName: replyBot.name,
                  others: groupParticipantNames(rows, attributeBotId, roster),
                }),
                images: [],
              }
            : null;
        const history: ApiMessage[] = [
          ...shared.head,
          ...(botBlock ? [botBlock] : []),
          ...(groupBlock ? [groupBlock] : []),
          ...shared.tail,
          ...compactHistory(
            rows,
            group,
            hasRenderer(selectRegistry(usePlugins.getState()), "youtube"),
          ),
        ];

        // Seed streaming state so the render layer shows the bubble immediately
        // (empty string — the "Thinking…" spinner hides on the first token).
        set({
          streamingContent: "",
          streamingToolCalls: [],
          streamingSubagents: [],
          streamingImages: [],
          streamingReasoning: "",
          streamingApiTrace: [],
          streamingBotId: attributeBotId,
          streamingProvider: replyProvider,
          streamingModel: replyModel,
        });

        // Stream the reply, appending a placeholder assistant bubble on the
        // first event and growing it as chunks arrive. Text arrives as content
        // deltas; tool calls arrive as structured events and render as chips.
        // The placeholder carries `bot_id` so a mentioned persona's
        // attribution renders while it is still streaming.
        let streamAcc = "";
        const toolCalls: MessageToolCall[] = [];
        const subagents: MessageSubagent[] = [];
        const foundImages: MessageImage[] = [];
        let reasoning = "";
        const apiTrace: ApiTraceEntry[] = [];
        let lastFlush = 0;
        const flushStreamingState = () => {
          set({
            streamingContent: streamAcc,
            streamingToolCalls: [...toolCalls],
            streamingSubagents: [...subagents],
            streamingImages: [...foundImages],
            streamingReasoning: reasoning,
            streamingApiTrace: [...apiTrace],
            ...(streamAcc.length > 0 ? { awaitingModel: false } : {}),
          });
        };
        const onDelta = (event: StreamEvent) => {
          if (event.approvalRequest) {
            const req = event.approvalRequest;
            if (get().autoApproveSysTools) {
              void approveToolCall(req.id, true);
            } else {
              set({ pendingApproval: req });
            }
            return;
          }
          applyToolEvent(event, toolCalls);
          applySubagentEvent(event, subagents);
          applyTraceEvent(event, apiTrace);
          if (event.reasoning) reasoning += event.reasoning.text;
          if (event.toolImages) {
            for (const img of event.toolImages.images) {
              foundImages.push({
                media_type: img.mediaType,
                data: img.data,
                source: img.sourceUrl,
                title: img.title,
              });
            }
          }
          if (event.text) streamAcc += event.text;
          if (event.toolDone || event.subagent) set({ awaitingModel: true });
          const now = performance.now();
          if (now - lastFlush > 100) {
            lastFlush = now;
            flushStreamingState();
          }
        };

        // On cancellation this still resolves with the partial text
        // accumulated so far (the backend early-exits and returns Ok), so the
        // same persistence path preserves whatever was generated.
        const started = Date.now();
        const result = await chatStream(
          replyProvider,
          replyModel,
          history,
          onDelta,
          threadId,
          deepResearch,
        );
        // Final flush — push any trailing tokens that arrived within the last
        // 100ms window, unfiltered.
        flushStreamingState();
        // Persist the assistant turn when it produced text, invoked a tool,
        // dispatched a subagent, or fetched images. (Skip a truly empty row,
        // e.g. cancelled before any token/tool call.)
        if (
          result.content.length > 0 ||
          toolCalls.length > 0 ||
          subagents.length > 0 ||
          foundImages.length > 0
        ) {
          const assistantMsg = await addMessage({
            thread_id: threadId,
            role: "assistant",
            content: result.content,
            duration_ms: Math.round(Date.now() - started),
            bot_id: attributeBotId,
          });
          // Batch independent attachment writes.
          await Promise.all([
            ...toolCalls.map((tc) =>
              addAttachment({
                message_id: assistantMsg.id,
                kind: "tool_call",
                media_type: "application/json",
                data: JSON.stringify(persistableToolCall(tc)),
              }),
            ),
            ...subagents.map((s) =>
              addAttachment({
                message_id: assistantMsg.id,
                kind: "subagent",
                media_type: "application/json",
                data: JSON.stringify(persistableSubagent(s)),
              }),
            ),
            ...foundImages.map((img) =>
              addAttachment({
                message_id: assistantMsg.id,
                kind: "image",
                media_type: img.media_type,
                data: img.data,
                filename: img.source,
              }),
            ),
            persistTransparency(assistantMsg.id, reasoning, apiTrace),
          ]);
          // Usage depends on the persisted message (needs message_id).
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
              thread_id: threadId,
              provider: replyProvider,
              model: result.model || replyModel,
              input_tokens: u.input_tokens,
              output_tokens: u.output_tokens,
              cache_creation_tokens: u.cache_creation_tokens,
              cache_read_tokens: u.cache_read_tokens,
            });
          }
        }
        // Clear streaming state and reload persisted messages.
        set({
          streamingContent: null,
          streamingToolCalls: [],
          streamingSubagents: [],
          streamingImages: [],
          streamingReasoning: "",
          streamingApiTrace: [],
          streamingBotId: null,
          streamingProvider: null,
          streamingModel: null,
        });
        {
          const msgs = await loadThreadMessages(threadId);
          if (get().currentThreadId === threadId) set({ messages: msgs });
        }
        await get().refreshThreads();
        return result;
      };

      /** Persona self-managed memory + mood (T40): review the exchange
       * off-path. Fire-and-forget — runPersonaMemoryUpdate never throws, so
       * it can neither delay nor fail the send path. NEVER runs for incognito
       * threads (session-only chats must leave no trace in the persona's
       * memory or mood), and only when the reply produced text to review. */
      const reviewExchange = (replyBot: Bot, replyText: string) => {
        if (
          !ephemeral &&
          (replyBot.auto_memory || replyBot.mood_enabled) &&
          replyText.length > 0
        ) {
          // Review on the persona's own model (matches the reply it produced).
          const { provider: rp, model: rm } = resolveReplyModel(
            replyBot,
            provider,
            model,
            hasKey,
          );
          void runPersonaMemoryUpdate(replyBot, content, replyText, rp, rm);
        }
      };

      if (mentioned.length > 0) {
        // Mention path (T43): the mentioned personas reply sequentially, in
        // mention order, each on the THREAD's provider/model (persona
        // defaults are ignored — one model for the whole "ask all" sequence,
        // no surprise key/provider switches). The thread's own persona is NOT
        // auto-invoked on this message — the mention replaces it for this
        // exchange. The mentioned persona talked with the user, so it may
        // remember it (same T40 toggles + incognito skip as a persona
        // thread).
        for (const mentionBot of mentioned) {
          // Stop (T3) cancels the remaining queue; the in-flight stream
          // still resolves with its partial text via the normal path.
          if (get().cancelling) break;
          const result = await runReply(mentionBot, mentionBot.id);
          reviewExchange(mentionBot, result.content);
        }
      } else {
        // Thread persona (T38) or plain reply — the single-reply path.
        const bot = botId ? await getBot(botId) : null;
        const result = await runReply(bot, null);
        if (bot) reviewExchange(bot, result.content);
      }
    } catch (e) {
      set({ error: friendlyError(e) });
      const id = get().currentThreadId;
      if (id) {
        const msgs = await loadThreadMessages(id);
        if (get().currentThreadId === id) set({ messages: msgs });
      }
    } finally {
      if (runningId) {
        const wasViewing = get().currentThreadId === runningId;
        set((s) => {
          const next = new Set(s.runningStreams);
          next.delete(runningId!);
          const updated = { ...s.threadPlannerProgress };
          delete updated[runningId!];
          const unread = new Set(s.unreadThreads);
          if (!wasViewing) unread.add(runningId!);
          return {
            runningStreams: next,
            threadPlannerProgress: updated,
            unreadThreads: unread,
            cancelling: false,
            pendingApproval: null,
            autoApproveSysTools: false,
            awaitingModel: false,
            streamingContent: null,
            streamingToolCalls: [],
            streamingSubagents: [],
            streamingImages: [],
            streamingReasoning: "",
            streamingApiTrace: [],
            streamingBotId: null,
            streamingProvider: null,
            streamingModel: null,
          };
        });
      }
      void get().refreshSystemTokens();
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
        workspaceId: get().draftWorkspaceId,
        ephemeral,
        botId: get().draftBotId,
      });
      id = thread.id;
      // Incognito threads never become last_thread_id (T29).
      if (!ephemeral) await setSetting(LAST_THREAD_KEY, id);
    }
    // Synthetic notes are standalone (no variation/regenerate controls).
    await addMessage({
      thread_id: id,
      role: "assistant",
      content,
      variant_group: null,
    });
    {
      const msgs = await loadThreadMessages(id);
      if (get().currentThreadId === id) set({ messages: msgs });
    }
    await get().refreshThreads();
    // Set currentThreadId after refreshThreads so the new thread is visible
    // to selectors reading the threads array immediately.
    set({ currentThreadId: id });
  },

  regenerate: async (messageId, direction) => {
    const id = get().currentThreadId;
    if (!id || get().runningStreams.has(id)) return;
    const msgs = get().messages;
    const i = msgs.findIndex((m) => m.id === messageId);
    if (i < 0) return;
    const target = msgs[i];
    const groupId = target.variant_group;
    // Only grouped assistant replies can branch (originals are self-grouped).
    if (target.role !== "assistant" || !groupId) return;

    const thread = get().threads.find((x) => x.id === id);
    if (!thread) return;
    const {
      provider,
      model,
      workspace_id: workspaceId,
      bot_id: threadBotId,
      workspace_files_excluded: workspaceFilesExcluded,
    } = thread;

    set((s) => ({
      runningStreams: new Set([...s.runningStreams, id]),
      cancelling: false,
      pendingApproval: null,
      autoApproveSysTools: false,
      awaitingModel: true,
      error: null,
    }));
    try {
      // System context, exactly as a fresh reply would assemble it. The reply's
      // own persona (an @-mention author wins over the thread persona) provides
      // the bot block; the history is everything BEFORE this reply's slot, so
      // the model answers the same prompt afresh.
      const shared = await loadSharedSystemBlocks(
        workspaceId,
        parseExcludedFileIds(workspaceFilesExcluded),
      );
      const attributeBotId = target.bot_id;
      const replyBot = attributeBotId
        ? await getBot(attributeBotId)
        : threadBotId
          ? await getBot(threadBotId)
          : null;
      const botBlock = replyBot ? await botSystemBlock(replyBot) : null;
      // Group labeling + per-persona model, assembled exactly as a fresh reply
      // (runReply) does, over the history BEFORE this reply's slot.
      const allBots = await listBots();
      const roster: Record<string, string> = {};
      for (const b of allBots) roster[b.id] = b.name;
      const keyed = useKeys.getState().present;
      const hasKey = (p: Provider) => isKeylessProvider(p) || keyed.has(p);
      const { provider: replyProvider, model: replyModel } = resolveReplyModel(
        replyBot,
        provider,
        model,
        hasKey,
      );
      const priorRows = msgs.slice(0, i);
      const group: GroupContext = {
        selfBotId: attributeBotId,
        roster,
        baseLabel: "Assistant",
      };
      const groupBlock: ApiMessage | null =
        replyBot && groupLabelingActive(priorRows, group)
          ? {
              role: "system",
              content: buildGroupChatSystemText({
                selfName: replyBot.name,
                others: groupParticipantNames(
                  priorRows,
                  attributeBotId,
                  roster,
                ),
              }),
              images: [],
            }
          : null;
      const baseHistory: ApiMessage[] = [
        ...shared.head,
        ...(botBlock ? [botBlock] : []),
        ...(groupBlock ? [groupBlock] : []),
        ...shared.tail,
        ...compactHistory(
          priorRows,
          group,
          hasRenderer(selectRegistry(usePlugins.getState()), "youtube"),
        ),
      ];
      // Steer for "a different variation" (+ optional direction), folded into
      // the trailing user turn so the call stays valid for every provider.
      const history = applyRegenSteer(
        baseHistory,
        direction,
        (content): ApiMessage => ({ role: "user", content, images: [] }),
      );

      // Seed streaming state.
      set({
        streamingContent: "",
        streamingToolCalls: [],
        streamingSubagents: [],
        streamingImages: [],
        streamingReasoning: "",
        streamingApiTrace: [],
        streamingBotId: attributeBotId,
        streamingProvider: replyProvider,
        streamingModel: replyModel,
      });
      let acc = "";
      const toolCalls: MessageToolCall[] = [];
      const subagents: MessageSubagent[] = [];
      const foundImages: MessageImage[] = [];
      let reasoning = "";
      const apiTrace: ApiTraceEntry[] = [];
      let lastFlush = 0;
      const flushStreamingState = () => {
        set({
          streamingContent: acc,
          streamingToolCalls: [...toolCalls],
          streamingSubagents: [...subagents],
          streamingImages: [...foundImages],
          streamingReasoning: reasoning,
          streamingApiTrace: [...apiTrace],
          streamingProvider: replyProvider,
          streamingModel: replyModel,
          ...(acc.length > 0 ? { awaitingModel: false } : {}),
        });
      };
      const onDelta = (event: StreamEvent) => {
        if (event.approvalRequest) {
          const req = event.approvalRequest;
          if (get().autoApproveSysTools) {
            void approveToolCall(req.id, true);
          } else {
            set({ pendingApproval: req });
          }
          return;
        }
        applyToolEvent(event, toolCalls);
        applySubagentEvent(event, subagents);
        applyTraceEvent(event, apiTrace);
        if (event.reasoning) reasoning += event.reasoning.text;
        if (event.toolImages) {
          for (const img of event.toolImages.images) {
            foundImages.push({
              media_type: img.mediaType,
              data: img.data,
              source: img.sourceUrl,
              title: img.title,
            });
          }
        }
        if (event.text) acc += event.text;
        if (event.toolDone || event.subagent) set({ awaitingModel: true });
        const now = performance.now();
        if (now - lastFlush > 100) {
          lastFlush = now;
          flushStreamingState();
        }
      };

      const started = Date.now();
      const result = await chatStream(
        replyProvider,
        replyModel,
        history,
        onDelta,
        id,
        thread.deep_research !== 0,
      );
      flushStreamingState();
      if (
        result.content.length > 0 ||
        toolCalls.length > 0 ||
        subagents.length > 0 ||
        foundImages.length > 0
      ) {
        const variantMsg = await addMessage({
          thread_id: id,
          role: "assistant",
          content: result.content,
          duration_ms: Math.round(Date.now() - started),
          bot_id: attributeBotId,
          variant_group: groupId,
        });
        await Promise.all([
          ...toolCalls.map((tc) =>
            addAttachment({
              message_id: variantMsg.id,
              kind: "tool_call",
              media_type: "application/json",
              data: JSON.stringify(persistableToolCall(tc)),
            }),
          ),
          ...subagents.map((s) =>
            addAttachment({
              message_id: variantMsg.id,
              kind: "subagent",
              media_type: "application/json",
              data: JSON.stringify(persistableSubagent(s)),
            }),
          ),
          ...foundImages.map((img) =>
            addAttachment({
              message_id: variantMsg.id,
              kind: "image",
              media_type: img.media_type,
              data: img.data,
              filename: img.source,
            }),
          ),
          persistTransparency(variantMsg.id, reasoning, apiTrace),
        ]);
        const u = result.usage;
        if (
          u &&
          (u.input_tokens > 0 ||
            u.output_tokens > 0 ||
            u.cache_creation_tokens > 0 ||
            u.cache_read_tokens > 0)
        ) {
          await addUsage({
            message_id: variantMsg.id,
            thread_id: id,
            provider: replyProvider,
            model: result.model || replyModel,
            input_tokens: u.input_tokens,
            output_tokens: u.output_tokens,
            cache_creation_tokens: u.cache_creation_tokens,
            cache_read_tokens: u.cache_read_tokens,
          });
        }
        await dbSelectVariant(groupId, variantMsg.id);
      }
      set({
        streamingContent: null,
        streamingToolCalls: [],
        streamingSubagents: [],
        streamingImages: [],
        streamingReasoning: "",
        streamingApiTrace: [],
        streamingBotId: null,
        streamingProvider: null,
        streamingModel: null,
      });
      {
        const msgs = await loadThreadMessages(id);
        if (get().currentThreadId === id) set({ messages: msgs });
      }
      await get().refreshThreads();
    } catch (e) {
      set({ error: friendlyError(e) });
      {
        const msgs = await loadThreadMessages(id);
        if (get().currentThreadId === id) set({ messages: msgs });
      }
    } finally {
      const wasViewing = get().currentThreadId === id;
      set((s) => {
        const next = new Set(s.runningStreams);
        next.delete(id);
        const unread = new Set(s.unreadThreads);
        if (!wasViewing) unread.add(id);
        return {
          runningStreams: next,
          unreadThreads: unread,
          cancelling: false,
          pendingApproval: null,
          autoApproveSysTools: false,
          awaitingModel: false,
          streamingContent: null,
          streamingToolCalls: [],
          streamingSubagents: [],
          streamingImages: [],
          streamingReasoning: "",
          streamingApiTrace: [],
          streamingBotId: null,
          streamingProvider: null,
          streamingModel: null,
        };
      });
      void get().refreshSystemTokens();
    }
  },

  selectVariant: async (groupId, messageId) => {
    const id = get().currentThreadId;
    if (!id || get().runningStreams.has(id)) return;
    await dbSelectVariant(groupId, messageId);
    {
      const msgs = await loadThreadMessages(id);
      if (get().currentThreadId === id) set({ messages: msgs });
    }
  },

  requestSources: async (messageId) => {
    const id = get().currentThreadId;
    if (!id || get().runningStreams.has(id)) return;
    const msgs = get().messages;
    const i = msgs.findIndex((m) => m.id === messageId);
    if (i < 0) return;
    const target = msgs[i];
    if (target.role !== "assistant") return;

    const thread = get().threads.find((x) => x.id === id);
    if (!thread) return;
    const {
      provider,
      model,
      workspace_id: workspaceId,
      bot_id: threadBotId,
      workspace_files_excluded: workspaceFilesExcludedSrc,
    } = thread;

    set((s) => ({
      runningStreams: new Set([...s.runningStreams, id]),
      cancelling: false,
      pendingApproval: null,
      autoApproveSysTools: false,
      awaitingModel: true,
      error: null,
    }));
    try {
      // Build system context the same way a normal reply would.
      const shared = await loadSharedSystemBlocks(
        workspaceId,
        parseExcludedFileIds(workspaceFilesExcludedSrc),
      );
      const attributeBotId = target.bot_id;
      const replyBot = attributeBotId
        ? await getBot(attributeBotId)
        : threadBotId
          ? await getBot(threadBotId)
          : null;
      const botBlock = replyBot ? await botSystemBlock(replyBot) : null;
      const allBots = await listBots();
      const roster: Record<string, string> = {};
      for (const b of allBots) roster[b.id] = b.name;
      const keyed = useKeys.getState().present;
      const hasKey = (p: Provider) => isKeylessProvider(p) || keyed.has(p);
      const { provider: replyProvider, model: replyModel } = resolveReplyModel(
        replyBot,
        provider,
        model,
        hasKey,
      );
      // Include rows UP TO AND INCLUDING the target reply, so the model sees
      // the reply it must source.
      const includedRows = msgs.slice(0, i + 1);
      const group: GroupContext = {
        selfBotId: attributeBotId,
        roster,
        baseLabel: "Assistant",
      };
      const groupBlock: ApiMessage | null =
        replyBot && groupLabelingActive(includedRows, group)
          ? {
              role: "system",
              content: buildGroupChatSystemText({
                selfName: replyBot.name,
                others: groupParticipantNames(
                  includedRows,
                  attributeBotId,
                  roster,
                ),
              }),
              images: [],
            }
          : null;
      const baseHistory: ApiMessage[] = [
        ...shared.head,
        ...(botBlock ? [botBlock] : []),
        ...(groupBlock ? [groupBlock] : []),
        ...shared.tail,
        ...compactHistory(
          includedRows,
          group,
          hasRenderer(selectRegistry(usePlugins.getState()), "youtube"),
        ),
      ];
      // Append an ephemeral user turn carrying the sources-request steer.
      const history = applySourcesSteer(
        baseHistory,
        (content): ApiMessage => ({ role: "user", content, images: [] }),
      );

      // Seed streaming state.
      set({
        streamingContent: "",
        streamingToolCalls: [],
        streamingSubagents: [],
        streamingImages: [],
        streamingReasoning: "",
        streamingApiTrace: [],
        streamingBotId: attributeBotId,
        streamingProvider: replyProvider,
        streamingModel: replyModel,
      });
      let acc = "";
      const toolCalls: MessageToolCall[] = [];
      const subagents: MessageSubagent[] = [];
      const foundImages: MessageImage[] = [];
      let reasoning = "";
      const apiTrace: ApiTraceEntry[] = [];
      let lastFlush = 0;
      const flushStreamingState = () => {
        set({
          streamingContent: acc,
          streamingToolCalls: [...toolCalls],
          streamingSubagents: [...subagents],
          streamingImages: [...foundImages],
          streamingReasoning: reasoning,
          streamingApiTrace: [...apiTrace],
          streamingProvider: replyProvider,
          streamingModel: replyModel,
          ...(acc.length > 0 ? { awaitingModel: false } : {}),
        });
      };
      const onDelta = (event: StreamEvent) => {
        if (event.approvalRequest) {
          const req = event.approvalRequest;
          if (get().autoApproveSysTools) {
            void approveToolCall(req.id, true);
          } else {
            set({ pendingApproval: req });
          }
          return;
        }
        applyToolEvent(event, toolCalls);
        applySubagentEvent(event, subagents);
        applyTraceEvent(event, apiTrace);
        if (event.reasoning) reasoning += event.reasoning.text;
        if (event.toolImages) {
          for (const img of event.toolImages.images) {
            foundImages.push({
              media_type: img.mediaType,
              data: img.data,
              source: img.sourceUrl,
              title: img.title,
            });
          }
        }
        if (event.text) acc += event.text;
        if (event.toolDone || event.subagent) set({ awaitingModel: true });
        const now = performance.now();
        if (now - lastFlush > 100) {
          lastFlush = now;
          flushStreamingState();
        }
      };

      const started = Date.now();
      const result = await chatStream(
        replyProvider,
        replyModel,
        history,
        onDelta,
        id,
        thread.deep_research !== 0,
      );
      flushStreamingState();
      if (
        result.content.length > 0 ||
        toolCalls.length > 0 ||
        subagents.length > 0 ||
        foundImages.length > 0
      ) {
        const sourcesMsg = await addMessage({
          thread_id: id,
          role: "assistant",
          content: result.content,
          duration_ms: Math.round(Date.now() - started),
          bot_id: attributeBotId,
          variant_group: null,
        });
        await Promise.all([
          ...toolCalls.map((tc) =>
            addAttachment({
              message_id: sourcesMsg.id,
              kind: "tool_call",
              media_type: "application/json",
              data: JSON.stringify(persistableToolCall(tc)),
            }),
          ),
          ...subagents.map((s) =>
            addAttachment({
              message_id: sourcesMsg.id,
              kind: "subagent",
              media_type: "application/json",
              data: JSON.stringify(persistableSubagent(s)),
            }),
          ),
          ...foundImages.map((img) =>
            addAttachment({
              message_id: sourcesMsg.id,
              kind: "image",
              media_type: img.media_type,
              data: img.data,
              filename: img.source,
            }),
          ),
          persistTransparency(sourcesMsg.id, reasoning, apiTrace),
        ]);
        const u = result.usage;
        if (
          u &&
          (u.input_tokens > 0 ||
            u.output_tokens > 0 ||
            u.cache_creation_tokens > 0 ||
            u.cache_read_tokens > 0)
        ) {
          await addUsage({
            message_id: sourcesMsg.id,
            thread_id: id,
            provider: replyProvider,
            model: result.model || replyModel,
            input_tokens: u.input_tokens,
            output_tokens: u.output_tokens,
            cache_creation_tokens: u.cache_creation_tokens,
            cache_read_tokens: u.cache_read_tokens,
          });
        }
      }
      set({
        streamingContent: null,
        streamingToolCalls: [],
        streamingSubagents: [],
        streamingImages: [],
        streamingReasoning: "",
        streamingApiTrace: [],
        streamingBotId: null,
        streamingProvider: null,
        streamingModel: null,
      });
      {
        const msgs = await loadThreadMessages(id);
        if (get().currentThreadId === id) set({ messages: msgs });
      }
      await get().refreshThreads();
    } catch (e) {
      set({ error: friendlyError(e) });
      {
        const msgs = await loadThreadMessages(id);
        if (get().currentThreadId === id) set({ messages: msgs });
      }
    } finally {
      const wasViewing = get().currentThreadId === id;
      set((s) => {
        const next = new Set(s.runningStreams);
        next.delete(id);
        const unread = new Set(s.unreadThreads);
        if (!wasViewing) unread.add(id);
        return {
          runningStreams: next,
          unreadThreads: unread,
          cancelling: false,
          pendingApproval: null,
          autoApproveSysTools: false,
          awaitingModel: false,
          streamingContent: null,
          streamingToolCalls: [],
          streamingSubagents: [],
          streamingImages: [],
          streamingReasoning: "",
          streamingApiTrace: [],
          streamingBotId: null,
          streamingProvider: null,
          streamingModel: null,
        };
      });
      void get().refreshSystemTokens();
    }
  },

  compact: async () => {
    const id = get().currentThreadId;
    if (!id || get().runningStreams.has(id) || get().compacting) return;
    const thread = get().threads.find((t) => t.id === id);
    if (!thread) return;
    set((s) => ({ runningStreams: new Set([...s.runningStreams, id]), compacting: true, cancelling: false, error: null }));
    try {
      const request = buildCompactionRequest(get().messages);
      // No streaming placeholder: the summary isn't a chat bubble; it lands as
      // a divider row once persisted.
      const result = await chatStream(
        thread.provider,
        thread.model,
        request,
        () => {},
        id,
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
      {
        const msgs = await loadThreadMessages(id);
        if (get().currentThreadId === id) set({ messages: msgs });
      }
      await get().refreshThreads();
    } catch (e) {
      set({ error: friendlyError(e) });
    } finally {
      const wasViewing = get().currentThreadId === id;
      set((s) => {
        const next = new Set(s.runningStreams);
        next.delete(id);
        const updated = { ...s.threadPlannerProgress };
        delete updated[id];
        const unread = new Set(s.unreadThreads);
        if (!wasViewing) unread.add(id);
        return {
          runningStreams: next,
          threadPlannerProgress: updated,
          unreadThreads: unread,
          compacting: false,
          cancelling: false,
        };
      });
    }
  },

  cancel: async () => {
    const tid = get().currentThreadId;
    if (!tid || !get().runningStreams.has(tid) || get().cancelling) return;
    // Clear any pending approval card — `cancel_stream` drains pending
    // approvals on the backend (declining them), unblocking a gated stream.
    set((s) => {
      const updated = { ...s.threadPlannerProgress };
      delete updated[tid];
      return { cancelling: true, pendingApproval: null, threadPlannerProgress: updated };
    });
    try {
      await cancelStream();
    } catch {
      // If the cancel request itself fails, the stream will still complete
      // normally; nothing actionable to surface to the user.
      set({ cancelling: false });
    }
  },

  resolveApproval: (approved, all = false) => {
    const req = get().pendingApproval;
    if (!req) return;
    set({
      pendingApproval: null,
      ...(approved && all ? { autoApproveSysTools: true } : {}),
    });
    void approveToolCall(req.id, approved);
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
    // Best-effort: tear down any live MCP sessions for the deleted thread.
    // A backend hiccup here must not strand the UI on the just-deleted thread,
    // so fire-and-forget (the idle reaper would reclaim them anyway).
    void mcpCloseThreadSessions(id).catch((e) =>
      console.warn("mcpCloseThreadSessions failed:", e),
    );
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
