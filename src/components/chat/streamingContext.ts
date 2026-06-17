import { createContext, useContext } from "react";

/**
 * True while the owning assistant reply is still streaming token-by-token.
 *
 * Renderers whose source is only valid once complete (e.g. `Mermaid`) read this
 * to defer rendering until the stream finishes — a partial diagram parses and
 * renders at many intermediate points as it grows, which otherwise flickers
 * badly mid-stream. Defaults to `false` so every non-streaming caller (loaded
 * history, the canvas preview, subagent summaries, reasoning) renders
 * immediately. Distinct from `ArtifactContext.messageId === null`, which is
 * *also* null for those non-streaming callers and so can't gate rendering.
 */
export const StreamingContext = createContext(false);

export const useStreaming = (): boolean => useContext(StreamingContext);
