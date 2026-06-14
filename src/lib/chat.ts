import { Channel, invoke } from "@tauri-apps/api/core";
import type { Provider, Role } from "@/types/db";
import { enabledServersForChat } from "@/lib/mcp";

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
): Promise<ChatResult> {
  const channel = new Channel<StreamEvent>();
  channel.onmessage = (msg) => onDelta(msg);
  // Provider-gated: the system-diagnostics tools are filtered out for cloud
  // providers unless the user opted in (local models always get them).
  const mcpServers = await enabledServersForChat(provider);
  return invoke("chat_stream", {
    provider,
    model,
    messages,
    onDelta: channel,
    mcpServers,
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
