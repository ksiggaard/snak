import { Fragment, useEffect, useRef } from "react";
import { MessageSquare, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { buildSnippet, highlightSegments } from "@/lib/search";
import { useSearch } from "@/store/search";
import { useT, useTp } from "@/store/i18n";
import type { SearchHit } from "@/types/db";

// T19 search, reshaped as a modal: a top-center input over a dimmed backdrop,
// with the matches (grouped by thread, highlighted snippet) listed in the same
// panel. Opened from the title bar / menus / Ctrl+K via the search store's
// `overlayOpen`; selecting a hit opens its thread and scrolls to the matched
// message (shared store → MessageList).

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
  const t = useT();
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
          {isTitle
            ? t("search.kindTitle")
            : hit.role === "user"
              ? t("search.kindUser")
              : t("search.kindAssistant")}
        </div>
        <div className="text-sm break-words">
          <Highlighted text={snippet} query={query} />
        </div>
      </div>
    </button>
  );
}

export function SearchOverlay() {
  const t = useT();
  const tp = useTp();
  const open = useSearch((s) => s.overlayOpen);
  const close = useSearch((s) => s.closeOverlay);
  const query = useSearch((s) => s.query);
  const setQuery = useSearch((s) => s.setQuery);
  const run = useSearch((s) => s.run);
  const results = useSearch((s) => s.results);
  const searching = useSearch((s) => s.searching);
  const ran = useSearch((s) => s.ran);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce the query (~200ms) so we don't hit the DB on every keystroke.
  useEffect(() => {
    if (!open || query.trim().length === 0) return;
    timer.current = setTimeout(() => void run(), 200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [open, query, run]);

  // Focus + select the input on open (the query persists across openings, so
  // typing immediately replaces the previous search).
  useEffect(() => {
    if (open) inputRef.current?.select();
  }, [open]);

  // Esc anywhere closes (the input may not hold focus once results are
  // clicked through with the mouse).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  const matchCount = results.reduce((n, g) => n + g.hits.length, 0);
  const hasQuery = query.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/40 px-4 pt-16"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="bg-popover text-popover-foreground flex h-fit max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border shadow-lg"
        role="dialog"
        aria-label={t("search.aria")}
      >
        <div className="relative shrink-0 p-2">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2" />
          <Input
            ref={inputRef}
            type="search"
            autoFocus
            value={query}
            placeholder={t("search.placeholder")}
            aria-label={t("search.aria")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void run();
            }}
            className="h-9 pr-8 pl-8"
          />
          {query.length > 0 && (
            <button
              type="button"
              aria-label={t("search.clear")}
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-4 -translate-y-1/2"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {hasQuery && (
          <>
            <div className="text-muted-foreground shrink-0 border-t px-4 py-1.5 text-xs">
              {searching
                ? t("search.searching")
                : ran
                  ? t("search.summary", {
                      matches: tp("search.matches", matchCount),
                      chats: tp("search.chats", results.length),
                    })
                  : ""}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2 pt-0">
              {!searching && ran && results.length === 0 && (
                <p className="text-muted-foreground px-3 py-4 text-center text-sm">
                  {t("search.noMatches", { query: query.trim() })}
                </p>
              )}

              {results.map((group) => (
                <div key={group.thread_id} className="mb-2">
                  <div className="text-muted-foreground px-3 pt-2 pb-1 text-xs font-semibold tracking-wide uppercase">
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
          </>
        )}
      </div>
    </div>
  );
}
