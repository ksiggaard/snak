// Pure helpers for the right-side chat panel: in-chat search, the
// user-message scroll spy, and the media gallery. UI in
// `src/components/chat/ChatPanel.tsx`.

import type { MessageImage, MessageView } from "@/lib/messages";
import { buildSnippet, searchTerms } from "@/lib/search";

export interface ChatSearchHit {
  id: string;
  role: string;
  snippet: string;
}

/**
 * Case-insensitive in-chat search over the loaded thread messages: every
 * whitespace-separated term must occur in a message's content (AND, mirroring
 * the FTS semantics of the global T19 search). Empty/whitespace queries match
 * nothing. Summary rows are searchable — they carry real content.
 */
export function searchChatMessages(
  messages: MessageView[],
  query: string,
): ChatSearchHit[] {
  const terms = searchTerms(query).map((t) => t.toLowerCase());
  if (terms.length === 0) return [];
  return messages
    .filter((m) => {
      const c = m.content.toLowerCase();
      return terms.every((t) => c.includes(t));
    })
    .map((m) => ({
      id: m.id,
      role: m.role,
      snippet: buildSnippet(m.content, query, 90),
    }));
}

export interface UserMessageEntry {
  id: string;
  label: string;
}

const LABEL_MAX = 80;

/** The user's own messages (scroll-spy entries), labeled by their first line. */
export function userMessageEntries(
  messages: MessageView[],
): UserMessageEntry[] {
  return messages
    .filter((m) => m.role === "user" && m.kind !== "summary")
    .map((m) => {
      const line = m.content.trim().split("\n", 1)[0];
      return {
        id: m.id,
        label: line.length > LABEL_MAX ? `${line.slice(0, LABEL_MAX)}…` : line,
      };
    });
}

export interface MediaEntry {
  messageId: string;
  image: MessageImage;
}

/** Every image shared in the thread, in message order, with its source
 * message id so the gallery can jump to where it was sent. */
export function mediaEntries(messages: MessageView[]): MediaEntry[] {
  return messages.flatMap((m) =>
    m.images.map((image) => ({ messageId: m.id, image })),
  );
}
