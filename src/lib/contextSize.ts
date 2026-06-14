// T53 (IDEA 24) — estimate how much context the next request will consume, for
// the live readout at the bottom of the chat. Tokens are only known *exactly*
// after a provider responds (captured into the usage table by T16); before
// sending there is no tokenizer in the app, so this is a deliberately rough,
// provider-agnostic estimate clearly labelled as such in the UI.
//
// Kept pure (no DOM/DB/React) so the math is unit-tested. It reuses the same
// document-injection seam as the real request (`appendDocumentsToContent`) so
// attached-document text is counted the same way it is actually sent.

import { compactHistory, type CompactableMessage } from "@/lib/compaction";
import { appendDocumentsToContent } from "@/lib/documents";

/** Rough English heuristic: ~4 characters per token. */
export const CHARS_PER_TOKEN = 4;
/** Flat per-image allowance — real cost is provider/resolution dependent. */
export const IMAGE_TOKENS_EST = 1000;

/** Estimate the tokens in a plain string (`ceil(len / 4)`). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate the tokens of a thread's API history — the post-compaction view
 * actually sent (summary + messages after it, with document text folded into
 * content), plus a flat allowance per image. Mirrors `compactHistory` so the
 * estimate tracks what the request really carries.
 */
export function estimateMessagesTokens(
  messages: readonly CompactableMessage[],
): number {
  let tokens = 0;
  for (const m of compactHistory(messages)) {
    tokens += estimateTokens(m.content);
    tokens += (m.images?.length ?? 0) * IMAGE_TOKENS_EST;
  }
  return tokens;
}

/** The composer's live total: thread history + the unsent draft. */
export function estimateContextTokens(args: {
  messages: readonly CompactableMessage[];
  draftText: string;
  draftImageCount: number;
  draftDocuments: { name: string; text: string }[];
}): number {
  const draftContent = appendDocumentsToContent(
    args.draftText,
    args.draftDocuments,
  );
  return (
    estimateMessagesTokens(args.messages) +
    estimateTokens(draftContent) +
    args.draftImageCount * IMAGE_TOKENS_EST
  );
}
