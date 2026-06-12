// Shared domain types mirroring the SQLite schema (see
// src-tauri/migrations/001_init.sql). Timestamps are SQLite `datetime('now')`
// strings (UTC, "YYYY-MM-DD HH:MM:SS").

export type Provider = "anthropic" | "openai" | "mistral" | "gemini";

export type Role = "user" | "assistant" | "system";

export interface Thread {
  id: string;
  title: string;
  provider: Provider;
  model: string;
  /** Project this thread belongs to, or null for a project-less thread. */
  project_id: string | null;
  /** 1 if pinned to the sidebar Favorites group, else 0 (T23). */
  favorite: number;
  /** 1 for an incognito (session-only) thread purged on next launch (T29). */
  ephemeral: number;
  /** 1 for an archived (closed-tab) thread: out of the open list until it's
   * opened from the Archive group, which promotes it back to 0. */
  archived: number;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  name: string;
  instructions: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectFile {
  id: string;
  project_id: string;
  name: string;
  /** Decoded UTF-8 text content, injected into the system context. */
  content: string;
  created_at: string;
}

export interface Model {
  id: number;
  provider: Provider;
  model_id: string;
  /** Friendly display label, e.g. "Opus 4.8". */
  label: string;
  sort_order: number;
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

export type AttachmentKind = "image" | "tool_call";

export interface Attachment {
  id: string;
  message_id: string;
  kind: AttachmentKind;
  media_type: string;
  /** Base64 payload or app-data file path, per `kind`/`media_type`. */
  data: string;
  created_at: string;
}
