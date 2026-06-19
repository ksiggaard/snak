import { useEffect, useRef, useState } from "react";
import { FileCode, Trash2 } from "lucide-react";
import { useLibrary } from "@/store/library";
import { useT, useTp } from "@/store/i18n";
import { relativeTime } from "@/lib/time";

export function ArtifactsPane() {
  const t = useT();
  const tp = useTp();
  const { items, load, openId, setOpenId, remove } = useLibrary();
  const [confirmId, setConfirmId] = useState<string | null>(null);
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
      <div className="text-sidebar-foreground/50 flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-xs">
        <FileCode className="size-10 opacity-30" />
        <p>{t("library.empty")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {items.map((item) => (
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
              className="w-full px-3 py-2 text-xs bg-sidebar-accent outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setOpenId(item.id)}
              onDoubleClick={() => {
                setRenameValue(item.title);
                setRenameId(item.id);
              }}
              className={`w-full px-3 py-2 text-left text-xs transition-colors ${
                openId === item.id
                  ? "bg-sidebar-accent text-sidebar-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
              }`}
            >
              <div className="flex items-center gap-2">
                <FileCode className="size-3.5 shrink-0 opacity-60" />
                <span className="truncate font-medium">{item.title}</span>
              </div>
              <div className="text-sidebar-foreground/40 mt-0.5 ml-[22px] flex items-center gap-2 text-[11px]">
                <span>{tp("artifact.fileCount", item.files.length)}</span>
                <span>·</span>
                <span>{relativeTime(new Date(item.updated_at))}</span>
              </div>
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmId(item.id);
            }}
            className="absolute right-2 top-2 text-sidebar-foreground/30 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label={t("library.deleteTooltip")}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
      {confirmId && (
        <div className="bg-sidebar/95 absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-xs">{t("library.deleteConfirm")}</p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                void remove(confirmId);
                setConfirmId(null);
              }}
              className="bg-destructive text-destructive-foreground rounded px-3 py-1 text-xs"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmId(null)}
              className="bg-sidebar-accent rounded px-3 py-1 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
