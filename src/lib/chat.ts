import { Channel, invoke } from "@tauri-apps/api/core";
import type { Provider, Role } from "@/types/db";
import {
  getCaptureReasoning,
  getCaptureTrace,
  getDeepResearchConcurrency,
} from "@/lib/db";
import { enabledServersForChat } from "@/lib/mcp";
import { useConnectivity, deriveOffline } from "@/store/connectivity";

export interface ApiImage {
  media_type: string;
  data: string;
}

export interface ApiMessage {
  role: Role;
  content: string;
  images?: ApiImage[];
}

/** Token usage for one completion, mirroring Rust `providers::Usage`. */
export interface ChatUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

export interface ChatResult {
  content: string;
  model: string;
  /** Per-response token usage captured from the stream's usage event(s). */
  usage: ChatUsage;
}

/** A tool the model invoked mid-stream (rendered as a distinct chip). */
export interface ToolCallEvent {
  /** Correlation id for the matching `toolOutput`/`toolDone` events. */
  id: string;
  name: string;
  /** Populated for the built-in `web__fetch_url` tool. */
  url?: string;
  /** Resolved command line / target, for tools that run one (sys diagnostics). */
  command?: string;
  /** The parsed tool input the model supplied — shown in the expanded tool
   * panel. Omitted by the backend for argument-less calls. */
  arguments?: unknown;
}

/** A chunk of a running tool's live output (a stdout line), keyed by call id. */
export interface ToolOutputEvent {
  id: string;
  chunk: string;
}

/** Marks a tool call finished, so the UI collapses its live panel. */
export interface ToolDoneEvent {
  id: string;
  ok: boolean;
}

/** One image a tool fetched (base64 bytes), to render + persist as a message
 * image attachment. Fields are camelCase (the Rust `ToolImage` serializes so). */
export interface ToolImageResult {
  mediaType: string;
  /** Base64-encoded image bytes (no `data:` prefix). */
  data: string;
  /** The page the image came from (linked in the lightbox). */
  sourceUrl?: string;
  title?: string;
}

/** Images produced by a single tool call (`search_images` / `fetch_images`),
 * keyed to that call's id. */
export interface ToolImagesEvent {
  id: string;
  images: ToolImageResult[];
}

/** One web source a tool consulted (a `search_web` hit or a `fetch_url` page).
 * Fields are camelCase (the Rust `ToolSource` serializes so). */
export interface ToolSource {
  /** The page URL — rendered as a clickable link. */
  url: string;
  /** Result title, when known (search hits have one; a bare fetch does not). */
  title?: string;
  /** A short excerpt: the search snippet, or the lead of a fetched page. */
  snippet?: string;
}

/** Web sources produced by a single tool call (`search_web` / `fetch_url`),
 * keyed to that call's id. */
export interface ToolSourcesEvent {
  id: string;
  sources: ToolSource[];
}

/**
 * A gated tool call awaiting the user's approval before it runs. Sent for the
 * read-only system-diagnostics server; the UI shows an approve/deny card and
 * replies via `approveToolCall(id, …)`.
 */
export interface ApprovalRequestEvent {
  id: string;
  toolName: string;
  /** Short action label, e.g. "Read file". */
  summary: string;
  /** The exact target — a path or the resolved command line. */
  detail: string;
}

/**
 * A research subagent's lifecycle event (deep research mode, T55). The `id` is
 * stable across a subagent's dispatched → running → done/failed events so the UI
 * updates one card. `task` rides the dispatched event; `summary` the done event.
 */
export interface SubagentEvent {
  id: string;
  phase: "dispatched" | "running" | "done" | "failed";
  task?: string;
  summary?: string;
}

/** A chunk of the model's reasoning / extended thinking (when reasoning capture
 * is on). Accumulated into the reply's collapsible reasoning panel. */
export interface ReasoningEvent {
  text: string;
}

/** One API-trace event (when trace capture is on): the redacted request body
 * before a round (`phase: "request"`), or a compact response summary after it
 * (`phase: "response"`). `round` groups the pair. */
export interface ApiTraceEvent {
  phase: "request" | "response";
  round: number;
  data: unknown;
}

/**
 * One streamed event from the backend: a text chunk (`text`), a notice that the
 * model called a tool (`toolCall`), or a request to approve a gated tool call
 * (`approvalRequest`). They are mutually exclusive on the wire (the Rust
 * `StreamDelta` omits whichever fields are absent).
 */
export interface StreamEvent {
  text?: string;
  toolCall?: ToolCallEvent;
  toolOutput?: ToolOutputEvent;
  toolDone?: ToolDoneEvent;
  approvalRequest?: ApprovalRequestEvent;
  /** Images a tool fetched (`search_images` / `fetch_images`), to render +
   * persist as message image attachments. */
  toolImages?: ToolImagesEvent;
  /** Web sources a tool consulted (`search_web` / `fetch_url`), shown as
   * clickable citations on the tool-activity chip. */
  toolSources?: ToolSourcesEvent;
  /** Lifecycle of a research subagent (deep research mode). */
  subagent?: SubagentEvent;
  /** A chunk of the model's reasoning/thinking (when reasoning capture is on). */
  reasoning?: ReasoningEvent;
  /** A raw API request/response trace event (when trace capture is on). */
  apiTrace?: ApiTraceEvent;
}

/**
 * Stream a completion from a provider. Text deltas arrive via `onDelta` as they
 * are generated; the promise resolves with the full accumulated response (the
 * authoritative text to persist). The API key is read from the keychain in the
 * Rust backend — it is never passed from or returned to the frontend.
 *
 * MCP (T13): the enabled MCP servers are read from settings here (not passed by
 * callers, so `send()`'s call site is unchanged) and handed to `chat_stream`.
 * When no server is enabled the backend gets `undefined` and behaves exactly as
 * before — no tools, a single provider round. Otherwise the backend exposes the
 * servers' tools to the model and runs the tool-call round-trip server-side,
 * still streaming text deltas through `onDelta` and resolving with the final
 * `{content, model, usage}`.
 */
export async function chatStream(
  provider: Provider,
  model: string,
  messages: ApiMessage[],
  onDelta: (event: StreamEvent) => void,
  threadId: string,
  deepResearch = false,
): Promise<ChatResult> {
  const channel = new Channel<StreamEvent>();
  channel.onmessage = (msg) => onDelta(msg);
  // Provider-gated: the system-diagnostics tools are filtered out for cloud
  // providers unless the user opted in (local models always get them). When
  // offline, the internet-requiring servers (`web`, `youtube`, custom http) are
  // also dropped so the model isn't offered tools it can't reach. Read the
  // connectivity store here so `send()`'s call site stays unchanged.
  const { status, forceOffline } = useConnectivity.getState();
  const offline = deriveOffline(status, forceOffline);
  const mcpServers = await enabledServersForChat(provider, offline);
  // Only read the subagent-concurrency setting when deep research is engaged;
  // null lets the backend apply its own default.
  const subagentConcurrency = deepResearch
    ? await getDeepResearchConcurrency()
    : null;
  // Transparency toggles (global, default off) — read here so caller sites stay
  // unchanged. When both are off the request is byte-identical to before.
  const [captureReasoning, captureTrace] = await Promise.all([
    getCaptureReasoning(),
    getCaptureTrace(),
  ]);
  return invoke("chat_stream", {
    provider,
    model,
    messages,
    onDelta: channel,
    mcpServers,
    threadId,
    deepResearch,
    subagentConcurrency,
    captureReasoning,
    captureTrace,
  });
}

/**
 * Request cancellation of the in-flight stream. The Rust backend sets a shared
 * flag the running provider loop observes; the pending `chatStream` promise then
 * resolves normally with whatever text was accumulated so far (partial output is
 * preserved, not discarded).
 */
export function cancelStream(): Promise<void> {
  return invoke("cancel_stream");
}

/**
 * Approve or deny a pending tool call (the per-call gate for the system-
 * diagnostics server). Denying tells the model the call was declined; the chat
 * loop continues. No-op on the backend if the call was already resolved.
 */
export function approveToolCall(id: string, approved: boolean): Promise<void> {
  return invoke("approve_tool_call", { id, approved });
}
