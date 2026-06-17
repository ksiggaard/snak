import type { StreamEvent, ToolSource } from "@/lib/chat";
import { listAttachments, listMessages } from "@/lib/db";
import { planVariants } from "@/lib/variations";
import type { Message } from "@/types/db";

export interface MessageImage {
  media_type: string;
  data: string; // base64
  /** For images found via `search_images`/`fetch_images`: the page the image
   * came from, linked in the lightbox. Persisted in the attachment `filename`
   * column; absent for user-attached images. */
  source?: string;
  /** Optional caption (the search result title); streaming-only — not persisted. */
  title?: string;
}

/** A tool the model invoked while producing an assistant message. Persisted as
 * a `tool_call` attachment so it survives reload and renders as a distinct chip
 * the model itself can't fabricate (it's structured data, not message text). */
export interface MessageToolCall {
  name: string;
  /** Populated for the built-in `web__fetch_url` tool. */
  url?: string;
  /** Correlation id (matches stream `tool_output`/`tool_done` events). */
  id?: string;
  /** Resolved command line / target, for tools that run one (sys diagnostics). */
  command?: string;
  /** The parsed tool input the model supplied — shown in the expanded panel so
   * it's evident exactly what arguments the model passed. Persisted (capped). */
  arguments?: unknown;
  /** Captured output (the tool's result text / streamed stdout), shown in the
   * collapsible activity panel. Persisted, capped. */
  output?: string;
  /** False when the tool errored; undefined/true otherwise. */
  ok?: boolean;
  /** Web sources the tool consulted (`web__search_web` hits / `web__fetch_url`
   * page): clickable citations shown in the activity panel. Persisted. */
  sources?: ToolSource[];
  /** Transient (streaming-only, never persisted): the tool is still executing,
   * so the activity panel renders expanded with a spinner. */
  running?: boolean;
}

/** A research subagent the orchestrator dispatched while producing an assistant
 * message (deep research mode, T55). Persisted as a `subagent` attachment so the
 * card survives reload — structured data the model can't fabricate, like a
 * tool-call record. */
export interface MessageSubagent {
  /** Stable id, correlating the subagent's lifecycle events to one card. */
  id: string;
  /** The subtask the orchestrator handed this subagent. */
  task: string;
  /** "dispatched" → "running" → "done" | "failed". */
  status: "dispatched" | "running" | "done" | "failed";
  /** The subagent's concise findings (set on "done"). */
  summary?: string;
}

/** Cap on persisted tool output, so a huge command result can't bloat the DB
 * row. The model already received the full (separately-capped) result; this is
 * only the reviewable UI copy. */
export const TOOL_OUTPUT_PERSIST_BUDGET = 20_000;

/** Cap on persisted tool arguments (serialized). Inputs are usually tiny; an
 * oversized one is dropped rather than bloating the row. */
export const TOOL_ARGS_PERSIST_BUDGET = 8_000;

/** One API-trace entry (developer/inspect panel): the redacted request body
 * before a round, or a compact response summary after it. Persisted as an
 * `api_trace` attachment (a JSON array of these), so the trace survives reload. */
export interface ApiTraceEntry {
  phase: "request" | "response";
  round: number;
  data: unknown;
}

/** A document attached to a user message (T39): the original file name plus
 * the *extracted text* (stored in the attachment row's `data`). */
export interface MessageDocument {
  name: string;
  media_type: string;
  text: string;
}

/** A persisted message plus its attachments (images + documents for user
 * turns, tool-call records for assistant turns) — used for display + API
 * history. */
export interface MessageView extends Message {
  images: MessageImage[];
  documents: MessageDocument[];
  toolCalls: MessageToolCall[];
  /** Research subagents dispatched while producing this reply (deep research,
   * T55). Empty for ordinary replies. */
  subagents: MessageSubagent[];
  /** The model's captured reasoning/thinking for this reply (when reasoning
   * capture was on). Persisted as a `reasoning` attachment; absent otherwise. */
  reasoning?: string;
  /** Raw per-round API trace for this reply (when trace capture was on).
   * Persisted as an `api_trace` attachment; absent otherwise. */
  apiTrace?: ApiTraceEntry[];
  /** Sibling variant ids (oldest→newest) when this reply belongs to a variant
   * group (T54), incl. this row's own id; undefined for ungrouped rows. The
   * UI shows the carousel + regenerate controls only when this is present. */
  variantIds?: string[];
}

/**
 * Fold a stream event's tool-lifecycle fields into the running `toolCalls`
 * accumulator (mutated in place): a `toolCall` appends a record rendered as a
 * live panel; `toolOutput` chunks append to its captured output; `toolDone`
 * stops its spinner. Text and approval events are handled by the caller (they
 * have side effects beyond the accumulator). Shared by the send + regenerate
 * streaming paths so both surface tool activity identically.
 */
export function applyToolEvent(
  event: StreamEvent,
  toolCalls: MessageToolCall[],
): void {
  if (event.toolCall) {
    toolCalls.push({
      id: event.toolCall.id,
      name: event.toolCall.name,
      url: event.toolCall.url,
      command: event.toolCall.command,
      arguments: event.toolCall.arguments,
      output: "",
      running: true,
    });
  }
  if (event.toolOutput) {
    const tc = toolCalls.find((c) => c.id === event.toolOutput!.id);
    if (tc) tc.output = (tc.output ?? "") + event.toolOutput.chunk + "\n";
  }
  if (event.toolSources) {
    const tc = toolCalls.find((c) => c.id === event.toolSources!.id);
    if (tc) tc.sources = [...(tc.sources ?? []), ...event.toolSources.sources];
  }
  if (event.toolDone) {
    const tc = toolCalls.find((c) => c.id === event.toolDone!.id);
    if (tc) {
      tc.running = false;
      tc.ok = event.toolDone.ok;
    }
  }
}

/**
 * Fold a subagent lifecycle event into the running `subagents` accumulator
 * (mutated in place): the first event for an id creates the card; later events
 * update its status, task, and (on done) summary. Mirrors `applyToolEvent` so
 * the streaming path stays uniform. (Deep research, T55.)
 */
export function applySubagentEvent(
  event: StreamEvent,
  subagents: MessageSubagent[],
): void {
  const s = event.subagent;
  if (!s) return;
  let rec = subagents.find((x) => x.id === s.id);
  if (!rec) {
    rec = { id: s.id, task: s.task ?? "", status: s.phase };
    subagents.push(rec);
  }
  rec.status = s.phase;
  if (s.task) rec.task = s.task;
  if (s.summary !== undefined) rec.summary = s.summary;
}

/**
 * Fold an API-trace event into the running `apiTrace` accumulator (mutated in
 * place): each request/response event is appended in arrival order. Mirrors
 * `applyToolEvent` so the send + regenerate streaming paths stay uniform.
 */
export function applyTraceEvent(
  event: StreamEvent,
  apiTrace: ApiTraceEntry[],
): void {
  const tr = event.apiTrace;
  if (!tr) return;
  apiTrace.push({ phase: tr.phase, round: tr.round, data: tr.data });
}

/**
 * Whether a stream event is the model producing *visible* output — a text or
 * reasoning chunk, or a tool call. This is the signal that the "Thinking…"
 * loader should hand off to the growing reply (`awaitingModel` clears here).
 *
 * Crucially it excludes the pre-request events that arrive *before* the model
 * has done anything: the API-trace `request` entry (emitted before the HTTP
 * call) and approval prompts. Treating those as "the model responded" hid the
 * loader during a slow first token — most visibly on local models, whose
 * prompt-eval can take many seconds before the first text arrives.
 */
export function isModelOutput(event: StreamEvent): boolean {
  return !!(event.text || event.reasoning || event.toolCall);
}

/** The JSON payload of a persisted `subagent` attachment (T55). */
export function persistableSubagent(s: MessageSubagent): MessageSubagent {
  return {
    id: s.id,
    task: s.task,
    status: s.status,
    summary: s.summary || undefined,
  };
}

/** Parse a persisted `subagent` attachment's JSON payload. Tolerant of
 * malformed rows (returns null, which the caller filters out). */
function parseSubagent(data: string): MessageSubagent | null {
  try {
    const obj = JSON.parse(data) as Partial<MessageSubagent>;
    if (obj && typeof obj.task === "string") {
      const status =
        obj.status === "dispatched" ||
        obj.status === "running" ||
        obj.status === "done" ||
        obj.status === "failed"
          ? obj.status
          : "done";
      return {
        id: typeof obj.id === "string" ? obj.id : "",
        task: obj.task,
        status,
        summary: typeof obj.summary === "string" ? obj.summary : undefined,
      };
    }
  } catch {
    // ignore malformed payloads
  }
  return null;
}

/** Strip the transient `running` flag and cap the captured output for storage,
 * yielding the JSON payload of a persisted `tool_call` attachment. */
export function persistableToolCall(tc: MessageToolCall): MessageToolCall {
  const output =
    tc.output && tc.output.length > TOOL_OUTPUT_PERSIST_BUDGET
      ? tc.output.slice(0, TOOL_OUTPUT_PERSIST_BUDGET) + "\n[… truncated]"
      : tc.output;
  // Tool inputs are normally tiny; drop an oversized one rather than bloat the
  // row (it's reviewable detail, not essential — the model still got it).
  const args =
    tc.arguments !== undefined &&
    JSON.stringify(tc.arguments).length <= TOOL_ARGS_PERSIST_BUDGET
      ? tc.arguments
      : undefined;
  return {
    name: tc.name,
    url: tc.url,
    id: tc.id,
    command: tc.command,
    arguments: args,
    output: output || undefined,
    ok: tc.ok,
    sources: tc.sources && tc.sources.length > 0 ? tc.sources : undefined,
  };
}

/** Parse the persisted `sources` array of a tool-call payload, keeping only
 * well-formed entries (each needs a string `url`). */
function parseToolSources(raw: unknown): ToolSource[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ToolSource[] = [];
  for (const s of raw) {
    if (
      s &&
      typeof s === "object" &&
      typeof (s as ToolSource).url === "string"
    ) {
      const src = s as ToolSource;
      out.push({
        url: src.url,
        title: typeof src.title === "string" ? src.title : undefined,
        snippet: typeof src.snippet === "string" ? src.snippet : undefined,
      });
    }
  }
  return out.length > 0 ? out : undefined;
}

/** Parse a persisted `tool_call` attachment's JSON payload. Tolerant of
 * malformed rows (returns null, which the caller filters out). */
function parseToolCall(data: string): MessageToolCall | null {
  try {
    const obj = JSON.parse(data) as Partial<MessageToolCall>;
    if (obj && typeof obj.name === "string") {
      return {
        name: obj.name,
        url: typeof obj.url === "string" ? obj.url : undefined,
        id: typeof obj.id === "string" ? obj.id : undefined,
        command: typeof obj.command === "string" ? obj.command : undefined,
        arguments: obj.arguments,
        output: typeof obj.output === "string" ? obj.output : undefined,
        ok: typeof obj.ok === "boolean" ? obj.ok : undefined,
        sources: parseToolSources(obj.sources),
      };
    }
  } catch {
    // ignore malformed payloads
  }
  return null;
}

/** Parse a persisted `api_trace` attachment (a JSON array of entries). Tolerant
 * of malformed rows (returns undefined). */
function parseApiTrace(data: string): ApiTraceEntry[] | undefined {
  try {
    const arr = JSON.parse(data) as unknown;
    if (!Array.isArray(arr)) return undefined;
    const out: ApiTraceEntry[] = [];
    for (const e of arr) {
      if (
        e &&
        typeof e === "object" &&
        ((e as ApiTraceEntry).phase === "request" ||
          (e as ApiTraceEntry).phase === "response")
      ) {
        const entry = e as ApiTraceEntry;
        out.push({
          phase: entry.phase,
          round: typeof entry.round === "number" ? entry.round : 0,
          data: entry.data,
        });
      }
    }
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Load a thread's messages with their attachments: user messages carry images,
 * assistant messages carry tool-call records. System rows carry neither, so we
 * skip the attachment query for them.
 */
export async function loadThreadMessages(
  threadId: string,
): Promise<MessageView[]> {
  const messages = await listMessages(threadId);
  // Collapse variant groups (T54) to one slot each — the *selected* variant,
  // positioned at the group's anchor — while carrying the sibling ids for the
  // carousel. Ungrouped rows pass through unchanged.
  const slots = planVariants(messages);
  return Promise.all(
    slots.map(async ({ emit: m, variantIds }): Promise<MessageView> => {
      const variants =
        variantIds && variantIds.length > 0 ? { variantIds } : {};
      // System rows and synthetic compaction summaries (T28) carry no
      // attachments, so skip the query for them.
      if (m.role === "system" || m.kind === "summary")
        return {
          ...m,
          images: [],
          documents: [],
          toolCalls: [],
          subagents: [],
          ...variants,
        };
      const attachments = await listAttachments(m.id);
      const images = attachments
        .filter((a) => a.kind === "image")
        .map((a) => ({
          media_type: a.media_type,
          data: a.data,
          // Found-image attachments stash their source page URL in `filename`.
          source: a.filename ?? undefined,
        }));
      const documents = attachments
        .filter((a) => a.kind === "document")
        .map((a) => ({
          name: a.filename ?? "document",
          media_type: a.media_type,
          text: a.data,
        }));
      const toolCalls = attachments
        .filter((a) => a.kind === "tool_call")
        .map((a) => parseToolCall(a.data))
        .filter((tc): tc is MessageToolCall => tc !== null);
      const subagents = attachments
        .filter((a) => a.kind === "subagent")
        .map((a) => parseSubagent(a.data))
        .filter((s): s is MessageSubagent => s !== null);
      // Transparency attachments: the model's reasoning (plain text) and the
      // raw API trace (JSON). At most one of each per reply.
      const reasoning = attachments.find((a) => a.kind === "reasoning")?.data;
      const apiTraceRaw = attachments.find((a) => a.kind === "api_trace")?.data;
      const apiTrace = apiTraceRaw ? parseApiTrace(apiTraceRaw) : undefined;
      return {
        ...m,
        images,
        documents,
        toolCalls,
        subagents,
        reasoning: reasoning || undefined,
        apiTrace,
        ...variants,
      };
    }),
  );
}

/** Build a thumbnail data URL from a stored image attachment. */
export function imageDataUrl(image: MessageImage): string {
  return `data:${image.media_type};base64,${image.data}`;
}
