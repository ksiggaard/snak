import { Channel, invoke } from "@tauri-apps/api/core";
import type { Provider, Role } from "@/types/db";

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

/**
 * Stream a completion from a provider. Text deltas arrive via `onDelta` as they
 * are generated; the promise resolves with the full accumulated response (the
 * authoritative text to persist). The API key is read from the keychain in the
 * Rust backend — it is never passed from or returned to the frontend.
 */
export function chatStream(
  provider: Provider,
  model: string,
  messages: ApiMessage[],
  onDelta: (text: string) => void,
): Promise<ChatResult> {
  const channel = new Channel<{ text: string }>();
  channel.onmessage = (msg) => onDelta(msg.text);
  return invoke("chat_stream", { provider, model, messages, onDelta: channel });
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
