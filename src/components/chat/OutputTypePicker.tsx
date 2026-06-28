import { useEffect, useRef, useState } from "react";
import { Check, SlidersHorizontal } from "lucide-react";
import { useThreads } from "@/store/threads";
import { selectRegistry, usePlugins } from "@/store/plugins";
import { useT } from "@/store/i18n";
import {
  availableOutputTypes,
  DEFAULT_OUTPUT_TYPE,
  type OutputTypeId,
} from "@/lib/outputTypes";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Composer toolbar control: pick a response-style "output type" (short, JSON,
 * plain-text, etc.) for the current thread (or the draft). Mirrors the
 * deep-research toggle's per-thread-or-draft read and the ModelChooser dropdown
 * pattern. The icon shows active while a non-default type is selected. The
 * artefact entry only appears when the artifacts renderer plugin is enabled.
 */
export function OutputTypePicker({ disabled }: { disabled?: boolean }) {
  const t = useT();
  const registry = usePlugins(selectRegistry);
  const options = availableOutputTypes(registry);

  const setOutputType = useThreads((s) => s.setOutputType);
  const selected = useThreads((s) =>
    s.currentThreadId
      ? ((s.threads.find((x) => x.id === s.currentThreadId)?.output_type ??
          DEFAULT_OUTPUT_TYPE) as OutputTypeId)
      : s.draftOutputType,
  );
  const active = selected !== DEFAULT_OUTPUT_TYPE;

  const [open, setOpen] = useState(false);
  const [openAbove, setOpenAbove] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleToggle = () => {
    if (!open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setOpenAbove(rect.top > window.innerHeight - rect.bottom);
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={active ? "default" : "ghost"}
            size="icon"
            aria-label={t("composer.outputType")}
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-pressed={active}
            disabled={disabled}
            onClick={handleToggle}
          >
            <SlidersHorizontal className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {t("composer.outputTypeTitle")}
        </TooltipContent>
      </Tooltip>

      {open && (
        <div
          role="listbox"
          aria-label={t("composer.outputType")}
          className={cn(
            "bg-popover text-popover-foreground ring-foreground/10 absolute left-0 z-50 min-w-48 rounded-lg p-1 shadow-md ring-1",
            openAbove ? "bottom-full mb-1" : "mt-1",
          )}
        >
          {options.map((o) => {
            const isSel = o.id === selected;
            return (
              <button
                key={o.id}
                role="option"
                aria-selected={isSel}
                type="button"
                onClick={() => {
                  void setOutputType(o.id);
                  setOpen(false);
                }}
                className="hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-sm"
              >
                <Check
                  className={cn(
                    "size-4 shrink-0",
                    isSel ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="flex-1 truncate text-left">
                  {t(o.labelKey)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
