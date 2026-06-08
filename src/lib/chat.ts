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

export interface ChatResult {
  content: string;
  model: string;
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
