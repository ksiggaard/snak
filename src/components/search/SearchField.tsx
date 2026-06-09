import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useSearch } from "@/store/search";

// Sidebar search field (T19). Debounces input and drives the shared search
// store; the results overlay (SearchResults) renders in the main pane.
export function SearchField() {
  const query = useSearch((s) => s.query);
  const setQuery = useSearch((s) => s.setQuery);
  const run = useSearch((s) => s.run);
  const clear = useSearch((s) => s.clear);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce the query (~200ms) so we don't hit the DB on every keystroke.
  useEffect(() => {
    if (query.trim().length === 0) return;
    timer.current = setTimeout(() => void run(), 200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, run]);

  return (
    <div className="relative">
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2" />
      <Input
        type="search"
        value={query}
        placeholder="Search chats…"
        aria-label="Search chats"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void run();
          if (e.key === "Escape") clear();
        }}
        className="h-8 pr-7 pl-8 text-sm"
      />
      {query.length > 0 && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => clear()}
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 -translate-y-1/2"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
