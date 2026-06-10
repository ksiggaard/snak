import { listAttachments, listMessages } from "@/lib/db";
import type { Message } from "@/types/db";

export interface MessageImage {
  media_type: string;
  data: string; // base64
}

/** A tool the model invoked while producing an assistant message. Persisted as
 * a `tool_call` attachment so it survives reload and renders as a distinct chip
 * the model itself can't fabricate (it's structured data, not message text). */
export interface MessageToolCall {
  name: string;
  /** Populated for the built-in `web__fetch_url` tool. */
  url?: string;
}

/** A persisted message plus its attachments (images for user turns, tool-call
 * records for assistant turns) — used for display + API history. */
export interface MessageView extends Message {
  images: MessageImage[];
  toolCalls: MessageToolCall[];
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
      };
    }
  } catch {
    // ignore malformed payloads
  }
  return null;
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
  return Promise.all(
    messages.map(async (m): Promise<MessageView> => {
      if (m.role === "system") return { ...m, images: [], toolCalls: [] };
      const attachments = await listAttachments(m.id);
      const images = attachments
        .filter((a) => a.kind === "image")
        .map((a) => ({ media_type: a.media_type, data: a.data }));
      const toolCalls = attachments
        .filter((a) => a.kind === "tool_call")
        .map((a) => parseToolCall(a.data))
        .filter((tc): tc is MessageToolCall => tc !== null);
      return { ...m, images, toolCalls };
    }),
  );
}

/** Build a thumbnail data URL from a stored image attachment. */
export function imageDataUrl(image: MessageImage): string {
  return `data:${image.media_type};base64,${image.data}`;
}
