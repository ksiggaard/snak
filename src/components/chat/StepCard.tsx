import { useState } from "react";
import { ChevronRight, Telescope } from "lucide-react";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/chat/Markdown";
import { ModelBadge } from "@/components/chat/ModelBadge";
import type { Provider } from "@/types/db";

interface StepCardProps {
  stepId?: string | null;
  description?: string | null;
  provider: Provider;
  model: string;
  content: string;
}

/** A collapsed-by-default card showing a planner worker step's output.
 *  Follows the same pattern as SubagentCard / ReasoningPanel. */
export function StepCard({ stepId, description, provider, model, content }: StepCardProps) {
  const [open, setOpen] = useState(false);
  const hasContent = content.trim().length > 0;
  const label = description?.trim() || stepId?.trim() || "Step";

  return (
    <div className="border-border bg-background/70 w-full max-w-full overflow-hidden rounded-md border text-xs">
      <button
        type="button"
        onClick={() => hasContent && setOpen((o) => !o)}
        disabled={!hasContent}
        title={label}
        className={cn(
          "text-muted-foreground flex w-full items-center gap-1.5 px-2 py-1",
          hasContent && "hover:bg-muted/50 cursor-pointer",
        )}
      >
        <Telescope className="size-3 shrink-0" aria-hidden />
        <span className="text-foreground/90 flex-1 truncate text-left">
          {label}
        </span>
        <ModelBadge provider={provider} model={model} />
        {hasContent && (
          <ChevronRight
            className={cn(
              "size-3 shrink-0 transition-transform",
              open && "rotate-90",
            )}
            aria-hidden
          />
        )}
      </button>
      {open && (
        <div className="border-border/60 text-foreground/80 border-t px-3 py-2">
          <Markdown content={content} />
        </div>
      )}
    </div>
  );
}
