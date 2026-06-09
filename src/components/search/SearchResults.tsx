import { Fragment } from "react";
import { MessageSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildSnippet, highlightSegments } from "@/lib/search";
import { cn } from "@/lib/utils";
import { useSearch } from "@/store/search";
import type { SearchHit } from "@/types/db";

// T19 search results view: matches grouped by thread, with a highlighted snippet
// of the matching text. Selecting a hit opens its thread (and scrolls to the
// matched message via the shared search store → MessageList).

function Highlighted({ text, query }: { text: string; query: string }) {
  const segments = highlightSegments(text, query);
  return (
    <>
      {segments.map((seg, i) =>
        seg.match ? (
          <mark
            key={i}
            className="bg-primary/25 text-foreground rounded-sm px-0.5"
          >
            {seg.text}
          </mark>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        ),
      )}
    </>
  );
}

function HitRow({ hit, query }: { hit: SearchHit; query: string }) {
  const openHit = useSearch((s) => s.openHit);
  const isTitle = hit.kind === "title";
  const snippet = buildSnippet(hit.text, query);

  return (
    <button
      type="button"
      onClick={() => void openHit(hit)}
      className="hover:bg-accent flex w-full items-start gap-2 rounded-md px-3 py-2 text-left"
    >
      <MessageSquare className="text-muted-foreground mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-muted-foreground mb-0.5 text-xs">
          {isTitle ? "Title" : hit.role === "user" ? "You" : "Assistant"}
        </div>
        <div className="text-sm break-words">
          <Highlighted text={snippet} query={query} />
        </div>
      </div>
    </button>
  );
}

export function SearchResults() {
  const query = useSearch((s) => s.query);
  const results = useSearch((s) => s.results);
  const searching = useSearch((s) => s.searching);
  const ran = useSearch((s) => s.ran);
  const clear = useSearch((s) => s.clear);

  const matchCount = results.reduce((n, g) => n + g.hits.length, 0);

  return (
    <div className="bg-card flex flex-1 flex-col overflow-hidden rounded-lg border">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <h2 className="text-sm font-medium">
          Search{query.trim() ? ` — “${query.trim()}”` : ""}
        </h2>
        <span className="text-muted-foreground text-xs">
          {searching
            ? "Searching…"
            : ran
              ? `${matchCount} ${matchCount === 1 ? "match" : "matches"} in ${
                  results.length
                } ${results.length === 1 ? "chat" : "chats"}`
              : ""}
        </span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => clear()}>
          <X className="size-4" />
          Close
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {!searching && ran && results.length === 0 && (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            No matches for “{query.trim()}”.
          </div>
        )}

        {results.map((group) => (
          <div key={group.thread_id} className="mb-3">
            <div
              className={cn(
                "text-muted-foreground px-3 pt-1 pb-1 text-xs font-semibold tracking-wide uppercase",
              )}
            >
              {group.thread_title}
            </div>
            {group.hits.map((hit) => (
              <HitRow
                key={`${hit.kind}:${hit.message_id || hit.thread_id}`}
                hit={hit}
                query={query}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
