import { useEffect, useRef } from "react";
import { Maximize2, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/chat/Markdown";
import type { PreparedImage } from "@/lib/image";

interface CanvasProps {
  /** Current draft Markdown — the same state the compact composer edits. */
  text: string;
  /** Edit the draft; round-trips back to the composer when the canvas closes. */
  onChange: (text: string) => void;
  /** Images already attached to the draft (previewed read-only here). */
  images: PreparedImage[];
  /** Remove an attached image by index. */
  onRemoveImage: (index: number) => void;
  /** Send the draft and close (mirrors the composer's send). */
  onSend: () => void;
  /** Whether sending is currently allowed (provider/key/non-empty gating). */
  canSend: boolean;
  /** Close the canvas, keeping the draft intact. */
  onClose: () => void;
}

/**
 * Canvas mode (T9): a large overlay for composing/editing long Markdown
 * messages with a live rendered preview (reusing the T8 `Markdown` renderer).
 *
 * The draft text/images live in the parent (`Composer`) so closing the canvas
 * round-trips the content straight back into the normal send flow — no copy,
 * no loss. Send here calls the same `onSend` the composer uses.
 */
export function Canvas({
  text,
  onChange,
  images,
  onRemoveImage,
  onSend,
  canSend,
  onClose,
}: CanvasProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus the editor on open and close on Escape.
  useEffect(() => {
    textareaRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="bg-background/80 fixed inset-0 z-50 flex flex-col p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Canvas editor"
    >
      <div className="bg-card flex flex-1 flex-col overflow-hidden rounded-lg border shadow-lg">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <div className="flex items-center gap-2">
            <Maximize2 className="text-muted-foreground size-4" />
            <span className="text-sm font-medium">Canvas</span>
            <span className="text-muted-foreground text-xs">
              Markdown editor with live preview
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close canvas"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
          {/* Editor */}
          <div className="flex min-h-0 flex-col border-b md:border-r md:border-b-0">
            <div className="text-muted-foreground border-b px-4 py-1.5 text-xs font-medium">
              Edit
            </div>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Compose a long Markdown message…"
              className="placeholder:text-muted-foreground min-h-0 flex-1 resize-none bg-transparent px-4 py-3 font-mono text-sm outline-none"
              onKeyDown={(e) => {
                // Cmd/Ctrl+Enter sends from the canvas; Enter inserts newlines
                // here (unlike the compact composer) since this is a long editor.
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (canSend) onSend();
                }
              }}
            />
          </div>

          {/* Preview */}
          <div className="flex min-h-0 flex-col">
            <div className="text-muted-foreground border-b px-4 py-1.5 text-xs font-medium">
              Preview
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {text.trim() ? (
                <Markdown content={text} />
              ) : (
                <p className="text-muted-foreground text-sm">
                  Nothing to preview yet.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Footer: attachments + send */}
        <div className="flex items-center justify-between gap-3 border-t px-4 py-2">
          {images.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {images.map((img, i) => (
                <div key={i} className="relative">
                  <img
                    src={img.dataUrl}
                    alt="attachment preview"
                    className="size-10 rounded-md object-cover"
                  />
                  <button
                    type="button"
                    aria-label="Remove image"
                    onClick={() => onRemoveImage(i)}
                    className="bg-background/80 absolute -top-1.5 -right-1.5 rounded-full border p-0.5"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-muted-foreground text-xs">
              Cmd/Ctrl+Enter to send · Esc to close (draft is kept)
            </span>
          )}
          <Button onClick={onSend} disabled={!canSend}>
            <Send className="size-4" />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
