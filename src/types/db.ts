// Shared domain types mirroring the SQLite schema (see
// src-tauri/migrations/001_init.sql). Timestamps are SQLite `datetime('now')`
// strings (UTC, "YYYY-MM-DD HH:MM:SS").

// Built-in local Ollama plus any user-added provider id (the cloud providers are
// now custom-provider entries, so their ids are ordinary strings). The
// `string & {}` arm keeps literal autocomplete for `ollama` while allowing
// arbitrary ids (validated/dispatched at runtime, not in the type).
export type Provider = "ollama" | (string & {});

export type Role = "user" | "assistant" | "system";

export interface Thread {
  id: string;
  title: string;
  provider: Provider;
  model: string;
  /** Workspace this thread belongs to, or null for a workspace-less thread. */
  workspace_id: string | null;
  /** 1 if pinned to the sidebar Favorites group, else 0 (T23). */
  favorite: number;
  /** 1 for an incognito (session-only) thread purged on next launch (T29). */
  ephemeral: number;
  /** 1 for an archived (closed-tab) thread: out of the open list until it's
   * opened from the Archive group, which promotes it back to 0. */
  archived: number;
  /** 1 = deep research mode is on for this thread (T55): the model may dispatch
   * parallel research subagents. Persisted so reopening the thread keeps it. */
  deep_research: number;
  /** Response-style selection for this thread (an `OutputTypeId`, e.g. "short",
   * "json", "default"). Injects one system instruction at send time. Persisted
   * so reopening the thread keeps it. "default" = no instruction. */
  output_type: string;
  /** Bot (persona) this thread belongs to, or null (T38). Deleting a bot
   * orphans its threads back to null — chat history is preserved. */
  bot_id: string | null;
  /** Per-chat excluded workspace-file ids (T61). A JSON array of workspace-file
   * ids the user has de-selected for this chat. NULL or "[]" = nothing excluded
   * = all files are injected (default all-selected). */
  workspace_files_excluded: string | null;
  /** 1 = planner mode is active for this thread. Sends are orchestrated by the
   * planner model instead of going directly to the thread's provider/model. */
  planner_active: number;
  /** Saved provider from before planner mode was toggled on, so toggling off
   * can restore it. NULL = never toggled / not in planner mode. */
  pre_planner_provider: Provider | null;
  /** Saved model from before planner mode was toggled on (paired with above). */
  pre_planner_model: string | null;
  created_at: string;
  updated_at: string;
}

/** A user-created persona with its own instructions, avatar, and memory (T38,
 * migration 013). */
export interface Bot {
  id: string;
  name: string;
  /** Short subtitle shown next to the name (e.g. "The IT architect"). */
  tagline: string;
  /** Personality/instructions injected into every chat with this bot. */
  instructions: string;
  /** How the persona approaches problems and structures answers (T40). */
  modus_operandi: string;
  /** How the persona sounds — register, warmth, directness (T40). */
  tone_of_voice: string;
  /** 1 = the persona manages its own memory rows after each exchange (T40). */
  auto_memory: number;
  /** 1 = the persona carries a persistent mood between conversations (T40). */
  mood_enabled: number;
  /** Current mood, set by the persona's follow-up call; "" = neutral (T40). */
  mood: string;
  /** Uploaded avatar MIME type; null (with avatar_data) = monogram fallback. */
  avatar_media_type: string | null;
  /** Uploaded avatar, base64 (no data: prefix); null = monogram fallback. */
  avatar_data: string | null;
  /** Optional default provider new chats with this bot inherit (set together
   * with default_model, or both null). */
  default_provider: Provider | null;
  /** Optional default model new chats with this bot inherit. */
  default_model: string | null;
  /** Conversation starters (JSON array of strings; migration 019) — opening
   * lines shown as one-tap chips on this persona's empty chat. "" = none. */
  starters: string;
  created_at: string;
  updated_at: string;
}

/** One free-text memory row for a bot (T38), mirroring `UserMemory`. */
export interface BotMemory {
  id: string;
  bot_id: string;
  content: string;
  /** Who created the row: the user (editor) or the persona itself (T40). */
  source: "user" | "auto";
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  instructions: string;
  /** Workspace-specific quick actions (JSON array; migration 018). Empty string =
   * no override, so the global quick actions apply. See `lib/quickActions.ts`. */
  quick_actions: string;
  /** 1 = inject workspace memory into the system context (default ON, T62). */
  memory_enabled: number;
  /** Profile image for the workspace dashboard (base64 JPEG, no data: prefix); null = no image. */
  profile_image: string | null;
  /** Cover/banner image for the workspace dashboard (base64 JPEG); null = no image. */
  cover_image: string | null;
  /** Profile image pan x offset (0-1, default center). */
  profile_image_x: number;
  /** Profile image pan y offset (0-1, default center). */
  profile_image_y: number;
  /** Profile image zoom scale (1.0 = natural cover size, min ensures circle always covered). */
  profile_image_zoom: number;
  /** Cover image pan x offset (0-1, default center). */
  cover_image_x: number;
  /** Cover image pan y offset (0-1, default center). */
  cover_image_y: number;
  created_at: string;
  updated_at: string;
}

/** One free-text memory row for a workspace (T62, migration 025). */
export interface WorkspaceMemory {
  id: string;
  workspace_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceFile {
  id: string;
  workspace_id: string;
  name: string;
  /** Decoded UTF-8 text content, injected into the system context. */
  content: string;
  /** Source URL for URL-ingested files (T59); null for uploaded files. */
  source_url: string | null;
  created_at: string;
}

export interface Model {
  id: number;
  provider: Provider;
  model_id: string;
  /** Friendly display label, e.g. "Opus 4.8". */
  label: string;
  sort_order: number;
  /** Free-text description of what this model is good at, shown in the picker. */
  notes: string;
}

/**
 * Message kinds (T28, migration 009): `normal` chat turns vs a synthetic
 * `summary` row marking a compaction point. Summary rows render as a divider
 * in the transcript; on send, the API history becomes [latest summary +
 * messages after it] (see `src/lib/compaction.ts`).
 */
export type MessageKind = "normal" | "summary";

export interface Message {
  id: string;
  thread_id: string;
  role: Role;
  content: string;
  /** 'normal' chat turn or a 'summary' compaction-point row (T28). */
  kind: MessageKind;
  /** Wall-clock generation time in ms for assistant replies; null otherwise. */
  duration_ms: number | null;
  /** Persona that authored this reply via an @-mention (T43, migration 016).
   * NULL for normal turns — including a thread persona's own replies, which
   * render off the thread's bot instead. */
  bot_id: string | null;
  /** Variation grouping (T54, migration 017). Assistant `normal` replies that
   * share a `variant_group` are alternatives at the same slot; the group id is
   * the original variant's id. NULL for user/system rows and `summary` rows. */
  variant_group: string | null;
  /** 1 if this is the selected variant of its group — the only one sent as
   * context. 0 for the other (browsable but un-injected) variants (T54). */
  variant_selected: number;
  /** Provider that generated this message; NULL = inherited from thread. */
  provider: Provider | null;
  /** Model that generated this message; NULL = inherited from thread. */
  model: string | null;
  /** Output type (response-style) active when this reply was generated
   * (migration 033). NULL = legacy/unknown row; treated as 'default' in the UI. */
  output_type: string | null;
  created_at: string;
}

/** A persisted per-response token-usage row (T16, migration 003). */
export interface Usage {
  id: string;
  message_id: string;
  thread_id: string;
  provider: Provider;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  created_at: string;
}

/** One free-text "memory about the user" row (T10, migration 005). */
export interface UserMemory {
  id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

/**
 * One full-text search hit (T19, migration 004). A hit is either a thread
 * **title** match or a **message** match; both carry the owning thread so the
 * UI can group results by thread and open the thread on selection.
 */
export interface SearchHit {
  /** Which searchable unit matched. */
  kind: "title" | "message";
  thread_id: string;
  /** Empty string for a title hit; the matched message's id otherwise. */
  message_id: string;
  /** The thread's current title (for grouping/labelling). */
  thread_title: string;
  /** The matched message's role (for message hits; "user" for title hits). */
  role: Role;
  /** The raw matched text (title or message content). */
  text: string;
  /** Message timestamp (or the thread's updated_at for a title hit). */
  created_at: string;
  /** FTS5 bm25 relevance score (lower = better); 0 for the LIKE fallback. */
  score: number;
}

/** Search hits for one thread, grouped for the results view. */
export interface ThreadSearchGroup {
  thread_id: string;
  thread_title: string;
  hits: SearchHit[];
}

export type AttachmentKind =
  | "image"
  | "tool_call"
  | "document"
  | "subagent"
  // Transparency captures on an assistant reply: the model's reasoning (plain
  // text) and the raw per-round API trace (JSON). At most one of each.
  | "reasoning"
  | "api_trace"
  // Planner-orchestrated plan: the JSON plan the planner model produced.
  | "plan";

export interface Attachment {
  id: string;
  message_id: string;
  kind: AttachmentKind;
  media_type: string;
  /** Base64 payload, extracted document text, or app-data file path, per
   * `kind`/`media_type`. */
  data: string;
  /** Original file name for `document` rows (T39, migration 012); null for
   * non-document rows. */
  filename: string | null;
  created_at: string;
}

/** One file inside an artifact: a relative path and its full text contents. */
export interface ArtifactFile {
  path: string;
  content: string;
}

/**
 * An artifact (migration 021): an LLM-generated multi-file web app emitted in a
 * ```artifact fenced block. Keyed by `(message_id, ordinal)` — the ordinal is
 * the artifact's position among the message's artifact blocks. `files` is the
 * editable, persisted file set (the block body is the initial source; in-app
 * edits are written back here).
 */
export interface Artifact {
  id: string;
  thread_id: string;
  message_id: string;
  ordinal: number;
  title: string;
  files: ArtifactFile[];
  created_at: string;
  updated_at: string;
}

/** A saved library artifact (migration 030): an independent copy of an
 *  artifact, untethered from any thread or message. */
export interface LibraryArtifact {
  id: string;
  title: string;
  files: ArtifactFile[];
  created_at: string;
  updated_at: string;
}
