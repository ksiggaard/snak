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
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  thread_id: string;
  role: Role;
  content: string;
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
