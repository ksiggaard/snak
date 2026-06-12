import { useEffect, useState } from "react";
import { lastMessages } from "@/lib/db";
import { flattenSnippet } from "@/lib/markdown";
import type { Thread } from "@/types/db";

const EMPTY: ReadonlyMap<string, string> = new Map();

/**
 * Last-message snippets for the visible thread list (T35 "Preview" rows),
 * keyed by thread id. Fetches in ONE query (`lastMessages` in lib/db.ts) and
 * only when `enabled` (i.e. the chat-list style is "preview") — other styles
 * cost nothing. Refreshes when the thread list reference changes (the threads
 * store reloads it after sends/renames/deletes, which also bump `updated_at`).
 * Threads without messages have no entry and degrade to a title-only row;
 * incognito threads behave like any other (their rows exist until purge).
 */
export function useThreadSnippets(
  threads: Thread[],
  enabled: boolean,
): ReadonlyMap<string, string> {
  const [snippets, setSnippets] = useState<ReadonlyMap<string, string>>(EMPTY);

  useEffect(() => {
    if (!enabled || threads.length === 0) return;
    let cancelled = false;
    lastMessages(threads.map((t) => t.id))
      .then((rows) => {
        if (cancelled) return;
        setSnippets(
          new Map(rows.map((r) => [r.thread_id, flattenSnippet(r.content)])),
        );
      })
      .catch(() => {
        // Sidebar previews are best-effort; a failed fetch just shows titles.
      });
    return () => {
      cancelled = true;
    };
  }, [threads, enabled]);

  return enabled ? snippets : EMPTY;
}
