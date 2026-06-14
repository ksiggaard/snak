import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/store/i18n";
import { cn } from "@/lib/utils";
import type { QuickAction, QuickActionMode } from "@/lib/quickActions";

interface QuickActionsEditorProps {
  /** Current list (controlled). */
  actions: QuickAction[];
  /** Emits the full updated list on any edit. */
  onChange: (actions: QuickAction[]) => void;
  disabled?: boolean;
}

/**
 * Controlled list editor for quick actions, shared by the global Settings card
 * and a project's override. Purely presentational — the parent owns the list
 * and decides when to persist. Each row edits label / prompt / click-mode and
 * can be reordered or removed; an "Add action" button appends a blank row.
 */
export function QuickActionsEditor({
  actions,
  onChange,
  disabled,
}: QuickActionsEditorProps) {
  const t = useT();

  function update(index: number, patch: Partial<QuickAction>) {
    onChange(actions.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  }

  function remove(index: number) {
    onChange(actions.filter((_, i) => i !== index));
  }

  function move(index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= actions.length) return;
    const copy = [...actions];
    [copy[index], copy[next]] = [copy[next], copy[index]];
    onChange(copy);
  }

  function add() {
    onChange([
      ...actions,
      { id: crypto.randomUUID(), label: "", prompt: "", mode: "prefill" },
    ]);
  }

  return (
    <div className="flex flex-col gap-3">
      {actions.length === 0 && (
        <p className="text-muted-foreground text-xs">{t("quickActions.empty")}</p>
      )}

      {actions.map((action, i) => (
        <div
          key={action.id}
          className="flex flex-col gap-2 rounded-md border p-3"
        >
          <div className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor={`qa-label-${action.id}`}>
                  {t("quickActions.label")}
                </Label>
                <Input
                  id={`qa-label-${action.id}`}
                  value={action.label}
                  disabled={disabled}
                  placeholder={t("quickActions.labelPlaceholder")}
                  onChange={(e) => update(i, { label: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`qa-prompt-${action.id}`}>
                  {t("quickActions.prompt")}
                </Label>
                <Textarea
                  id={`qa-prompt-${action.id}`}
                  rows={2}
                  value={action.prompt}
                  disabled={disabled}
                  placeholder={t("quickActions.promptPlaceholder")}
                  onChange={(e) => update(i, { prompt: e.target.value })}
                />
              </div>
              <ModeToggle
                value={action.mode}
                disabled={disabled}
                onChange={(mode) => update(i, { mode })}
              />
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              <button
                type="button"
                aria-label={t("quickActions.moveUp")}
                disabled={disabled || i === 0}
                onClick={() => move(i, -1)}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronUp className="size-4" />
              </button>
              <button
                type="button"
                aria-label={t("quickActions.moveDown")}
                disabled={disabled || i === actions.length - 1}
                onClick={() => move(i, 1)}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronDown className="size-4" />
              </button>
              <button
                type="button"
                aria-label={t("quickActions.remove")}
                disabled={disabled}
                onClick={() => remove(i)}
                className="text-muted-foreground hover:text-destructive disabled:opacity-30"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </div>
        </div>
      ))}

      <div>
        <Button variant="outline" size="sm" onClick={add} disabled={disabled}>
          {t("quickActions.add")}
        </Button>
      </div>
    </div>
  );
}

/** Segmented Prefill/Send toggle for a single action's click mode. */
function ModeToggle({
  value,
  onChange,
  disabled,
}: {
  value: QuickActionMode;
  onChange: (mode: QuickActionMode) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const opt = (mode: QuickActionMode, label: string) => (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={value === mode}
      onClick={() => onChange(mode)}
      className={cn(
        "rounded px-2 py-1 text-xs font-medium transition-colors",
        value === mode
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-xs">
        {t("quickActions.mode")}
      </span>
      <div className="bg-muted inline-flex gap-1 rounded-md p-0.5">
        {opt("prefill", t("quickActions.modePrefill"))}
        {opt("send", t("quickActions.modeSend"))}
      </div>
    </div>
  );
}
