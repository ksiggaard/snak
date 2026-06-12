import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/store/confirm";
import { useT } from "@/store/i18n";

/**
 * The single confirmation modal, mounted once at the app root. Driven by the
 * `useConfirm` store: `confirmDialog(...)` opens it and resolves with the user's
 * choice. Replaces the webview's broken native `window.confirm()`.
 */
export function ConfirmDialog() {
  const t = useT();
  const open = useConfirm((s) => s.open);
  const options = useConfirm((s) => s.options);
  const respond = useConfirm((s) => s.respond);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus the confirm button when opened, and wire Enter/Escape globally so the
  // dialog is keyboard-operable regardless of where focus was.
  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        respond(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        respond(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, respond]);

  if (!open || !options) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => respond(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={options.title}
        className="bg-background w-full max-w-sm rounded-lg border p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">{options.title}</h2>
        {options.description && (
          <p className="text-muted-foreground mt-2 text-sm">
            {options.description}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => respond(false)}>
            {options.cancelText ?? t("common.cancel")}
          </Button>
          <Button
            ref={confirmRef}
            size="sm"
            variant={options.destructive ? "destructive" : "default"}
            onClick={() => respond(true)}
          >
            {options.confirmText ?? t("common.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
