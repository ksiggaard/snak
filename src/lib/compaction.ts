// T28 — chat compaction (context summarization). Pure logic for assembling the
// API history of a thread that may contain `summary` rows (compaction points),
// and for building the summarization request itself. Persistence is
// **non-destructive**: every message row is kept for display; a compaction just
// inserts one synthetic `kind: "summary"` row, and subsequent sends carry
// [summary content + messages after it] instead of the full history. Compacting
// twice composes: the second summarization input is exactly the first's
// compacted history (previous summary + newer messages).

import type { ApiMessage } from "@/lib/chat";
import type { MessageKind, Role } from "@/types/db";

/** The minimal message shape compaction logic needs (MessageView satisfies it). */
export interface CompactableMessage {
  role: Role;
  content: string;
  kind: MessageKind;
  images?: { media_type: string; data: string }[];
}

/** Index of the latest `summary` row, or -1 when the thread was never compacted. */
export function latestSummaryIndex(
  messages: readonly { kind: MessageKind }[],
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].kind === "summary") return i;
  }
  return -1;
}

/**
 * Whether there is enough new history to compact: at least 2 messages (one
 * exchange) after the latest compaction point. Thread existence and busy state
 * are gated at the call site.
 */
export function canCompact(
  messages: readonly { kind: MessageKind }[],
): boolean {
  return messages.length - (latestSummaryIndex(messages) + 1) >= 2;
}

/** Frames the stored summary text when it is injected into the API history. */
export function summaryContext(summary: string): string {
  return (
    "Summary of the conversation so far (earlier messages were compacted " +
    "to save context):\n\n" +
    summary
  );
}

/**
 * Assemble the API history for a thread transcript: everything after the
 * latest `summary` row, preceded by the summary itself injected as a leading
 * `user` turn (safe for all four providers — the first non-system message is a
 * user message). A never-compacted thread maps through unchanged. Leading
 * system context (global/project/skills) is unshifted by the caller afterwards,
 * so it is never summarized away.
 */
export function compactHistory(
  messages: readonly CompactableMessage[],
): ApiMessage[] {
  const cut = latestSummaryIndex(messages);
  const after = messages.slice(cut + 1).map(
    (m): ApiMessage => ({
      role: m.role,
      content: m.content,
      images: m.images ?? [],
    }),
  );
  if (cut === -1) return after;
  return [
    {
      role: "user",
      content: summaryContext(messages[cut].content),
      images: [],
    },
    ...after,
  ];
}

/** System framing for the summarization call. */
export const COMPACT_SYSTEM_PROMPT =
  "You are compacting a chat conversation so it can continue with a smaller " +
  "context. Produce a faithful, self-contained summary of the conversation; " +
  "it will replace the older messages in future requests.";

/** The closing user instruction of the summarization call. */
export const COMPACT_INSTRUCTION =
  "Summarize the conversation above so it can continue seamlessly without " +
  "the original messages. Capture: the user's goals and open questions, key " +
  "facts and decisions, constraints and preferences, and any unfinished " +
  "threads. Be concise but lose nothing essential. Reply with the summary " +
  "only — no preamble.";

/**
 * Build the messages for the summarization request: the compacted history
 * (which already folds in a previous summary, so repeated compactions compose)
 * framed by a system prompt and a final user instruction. Images are stripped —
 * summaries are text-only and re-sending attachments would defeat the point of
 * shrinking the context.
 */
export function buildCompactionRequest(
  messages: readonly CompactableMessage[],
): ApiMessage[] {
  return [
    { role: "system", content: COMPACT_SYSTEM_PROMPT, images: [] },
    ...compactHistory(messages).map((m) => ({ ...m, images: [] })),
    { role: "user", content: COMPACT_INSTRUCTION, images: [] },
  ];
}
