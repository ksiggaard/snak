import { useEffect, useRef, useState } from "react";
import { FileCode, Trash2 } from "lucide-react";
import { useLibrary } from "@/store/library";
import { confirmDialog } from "@/store/confirm";
import { t as tNow, useT, useTp } from "@/store/i18n";
import { relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export function ArtifactsPane() {
  const t = useT();
  const tp = useTp();
  const { items, load, openId, setOpenId, remove } = useLibrary();
  const [renamingId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (renamingId && renameRef.current) renameRef.current.select();
  }, [renamingId]);

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground px-2 py-4 text-xs">
        {t("library.empty")}
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {items.map((item) => {
        const active = openId === item.id;
        return (
          <div key={item.id} className="group relative">
            {renamingId === item.id ? (
              <input
                ref={renameRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => {
                  if (renameValue.trim()) {
                    void useLibrary.getState().rename(item.id, renameValue.trim());
                  }
                  setRenameId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  } else if (e.key === "Escape") {
                    setRenameId(null);
                  }
                }}
                className="bg-sidebar-accent w-full rounded-md px-3 py-2 text-xs outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => setOpenId(item.id)}
                onDoubleClick={() => {
                  setRenameValue(item.title);
                  setRenameId(item.id);
                }}
                className={cn(
                  "flex w-full flex-col rounded-md px-3 py-2 text-left transition-transform hover:translate-x-[3px]",
                  active
                    ? "bg-primary/10 hover:bg-primary/15"
                    : "hover:bg-sidebar-accent/50",
                )}
              >
                {active && (
                  <span
                    aria-hidden
                    className="bg-primary absolute inset-y-1 left-0 w-[3px] rounded-r-full"
                  />
                )}
                <span className="flex items-center gap-2">
                  <FileCode className="size-3.5 shrink-0 opacity-60" />
                  <span
                    className={cn(
                      "truncate text-sm",
                      active && "text-foreground font-medium",
                    )}
                  >
                    {item.title}
                  </span>
                </span>
                <span className="text-muted-foreground mt-0.5 ml-[22px] flex items-center gap-2 text-[11px]">
                  <span>{tp("artifact.fileCount", item.files.length)}</span>
                  <span>·</span>
                  <span>{relativeTime(new Date(item.updated_at))}</span>
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void confirmDialog({
                  title: tNow("library.deleteConfirm"),
                  confirmText: tNow("common.delete"),
                  destructive: true,
                }).then((ok) => {
                  if (ok) void remove(item.id);
                });
              }}
              className="text-muted-foreground hover:text-destructive absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100"
              aria-label={t("library.deleteTooltip")}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
