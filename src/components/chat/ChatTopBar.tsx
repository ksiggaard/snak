import { useState } from "react";
import { PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/store/i18n";
import { useAppearance } from "@/store/appearance";
import { cn } from "@/lib/utils";

/** Height of the chat topbar in px. MessageList reserves this much top inset (a
 *  spacer div above the first row) so the first message clears the overlaid bar.
 *  Keep in sync with the `h-11` class below. */
export const CHAT_TOPBAR_H = 44;

interface ChatTopBarProps {
  title: string;
  /** Hidden (slid up) when scrolling down; shown on scroll-up / near top. Owned
   *  by ChatView so the sticky-prompt offset shares this single source. */
  hidden: boolean;
  panelOpen: boolean;
  onOpenPanel: () => void;
  /** Only saved threads can be renamed (a draft has no DB row yet). */
  canRename: boolean;
  onRename: (title: string) => void;
}

/** Web-style chat header: the thread name (double-click to rename) on the left,
 *  the chat-panel toggle on the right. Overlays the top of the message column;
 *  shows on scroll-up / near the top, slides away on scroll-down (`hidden`,
 *  driven by ChatView's scroll listener). */
export function ChatTopBar({
  title,
  hidden,
  panelOpen,
  onOpenPanel,
  canRename,
  onRename,
}: ChatTopBarProps) {
  const t = useT();
  // Sticky prompts pin just below this bar; an opaque bar then blocks the reply
  // from showing in the strip above the pinned prompt (translucent would bleed).
  const stickyPrompts = useAppearance((s) => s.stickyPrompts);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

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
        "border-border/60 absolute inset-x-0 top-0 z-20 flex h-11 items-center gap-2 border-b px-3 transition-transform duration-200",
        // Opaque when sticky prompts are on (it backs the pinned prompt);
        // translucent blur otherwise (content dissolves under it as before).
        stickyPrompts ? "bg-background" : "bg-background/80 backdrop-blur-sm",
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
