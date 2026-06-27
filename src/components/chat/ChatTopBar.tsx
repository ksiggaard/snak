import { useEffect, useState } from "react";
import { PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/store/i18n";
import { cn } from "@/lib/utils";

/** Height of the chat topbar in px. MessageList reserves this much top inset (a
 *  spacer div above the first row) so the first message clears the overlaid bar.
 *  Keep in sync with the `h-11` class below. */
export const CHAT_TOPBAR_H = 44;

interface ChatTopBarProps {
  title: string;
  panelOpen: boolean;
  onOpenPanel: () => void;
  /** Only saved threads can be renamed (a draft has no DB row yet). */
  canRename: boolean;
  onRename: (title: string) => void;
}

/** Web-style chat header: the thread name (double-click to rename) on the left,
 *  the chat-panel toggle on the right. Overlays the top of the message column;
 *  shows on scroll-up / near the top, slides away on scroll-down — its blurred
 *  background also masks the messages' top cutoff. */
export function ChatTopBar({
  title,
  panelOpen,
  onOpenPanel,
  canRename,
  onRename,
}: ChatTopBarProps) {
  const t = useT();
  const [hidden, setHidden] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  // Hide on scroll down, reveal on scroll up or near the top. Direction-aware
  // show/hide isn't expressible in CSS (scroll-driven animations track
  // position, not direction), so a small JS listener is the minimal correct
  // approach. Scroll events don't bubble but ARE dispatched through the capture
  // phase, so one capturing listener on `document` catches scroll from whatever
  // node currently has [data-chat-scroll] — robust to the scroll container
  // mounting/unmounting (e.g. thread switch), which a direct addEventListener is
  // not (it would be left on a detached node).
  useEffect(() => {
    let lastY: number | null = null;
    let ticking = false;
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (!el?.matches?.("[data-chat-scroll]")) return;
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = el.scrollTop;
        if (lastY === null) {
          lastY = y; // first sighting (incl. the load-time scroll-to-bottom)
        } else {
          const dy = y - lastY;
          if (y < 24 || dy < -4)
            setHidden(false); // near top OR scrolling up
          else if (dy > 4) setHidden(true); // scrolling down
          lastY = y;
        }
        ticking = false;
      });
    };
    document.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    return () =>
      document.removeEventListener("scroll", onScroll, { capture: true });
  }, []);

  function beginEdit() {
    if (!canRename) return;
    setDraft(title);
    setEditing(true);
  }
  function commitEdit() {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== title) onRename(next);
  }

  return (
    <div
      className={cn(
        "bg-background/80 border-border/60 absolute inset-x-0 top-0 z-20 flex h-11 items-center gap-2 border-b px-3 backdrop-blur-sm transition-transform duration-200",
        hidden && "-translate-y-full",
      )}
    >
      {editing ? (
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") setEditing(false);
          }}
          className="h-7 text-sm"
        />
      ) : canRename ? (
        <button
          type="button"
          onDoubleClick={beginEdit}
          title={t("sidebar.renameHint")}
          className="text-foreground min-w-0 flex-1 truncate text-left text-sm font-medium"
        >
          {title}
        </button>
      ) : (
        <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
          {title}
        </span>
      )}
      {!panelOpen && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("panel.open")}
          title={t("panel.open")}
          onClick={onOpenPanel}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <PanelRight className="size-4" />
        </Button>
      )}
    </div>
  );
}
