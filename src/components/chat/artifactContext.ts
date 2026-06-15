import { createContext, useContext } from "react";

/**
 * Carries the owning message/thread identity from `MessageList` down through
 * `Markdown` to each `ArtifactCard` (mirrors `SuppressedVideosContext`). A card
 * has no other way to know which persisted message it belongs to.
 *
 * `messageId`/`threadId` are null while a reply is still streaming (the
 * placeholder row has no real id yet), so a streaming artifact renders
 * ephemerally and only persists once the message is saved.
 *
 * `ordinalFor` returns a stable, idempotent 0-based index for a card's slot key
 * (its `useId`), so multiple artifacts in one message get distinct, reproducible
 * ordinals across re-renders and React strict-mode double-renders.
 */
export interface ArtifactCtx {
  messageId: string | null;
  threadId: string | null;
  ordinalFor: (slotKey: string) => number;
}

const NOOP: ArtifactCtx = {
  messageId: null,
  threadId: null,
  ordinalFor: () => 0,
};

export const ArtifactContext = createContext<ArtifactCtx>(NOOP);

export const useArtifactContext = (): ArtifactCtx =>
  useContext(ArtifactContext);
