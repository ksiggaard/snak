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

export interface Message {
  id: string;
  thread_id: string;
  role: Role;
  content: string;
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

export type AttachmentKind = "image";

export interface Attachment {
  id: string;
  message_id: string;
  kind: AttachmentKind;
  media_type: string;
  /** Base64 payload or app-data file path, per `kind`/`media_type`. */
  data: string;
  created_at: string;
}
