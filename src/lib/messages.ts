import { listAttachments, listMessages } from "@/lib/db";
import type { Message } from "@/types/db";

export interface MessageImage {
  media_type: string;
  data: string; // base64
}

/** A persisted message plus its image attachments (for display + API history). */
export interface MessageView extends Message {
  images: MessageImage[];
}

/**
 * Load a thread's messages with their image attachments. Only user messages
 * carry images, so we skip the attachment query for assistant/system rows.
 */
export async function loadThreadMessages(
  threadId: string,
): Promise<MessageView[]> {
  const messages = await listMessages(threadId);
  return Promise.all(
    messages.map(async (m): Promise<MessageView> => {
      if (m.role !== "user") return { ...m, images: [] };
      const attachments = await listAttachments(m.id);
      const images = attachments
        .filter((a) => a.kind === "image")
        .map((a) => ({ media_type: a.media_type, data: a.data }));
      return { ...m, images };
    }),
  );
}

/** Build a thumbnail data URL from a stored image attachment. */
export function imageDataUrl(image: MessageImage): string {
  return `data:${image.media_type};base64,${image.data}`;
}
