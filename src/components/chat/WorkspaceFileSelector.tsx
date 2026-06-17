/**
 * T61: Per-chat workspace file selector.
 *
 * A small button in the Composer's bottom bar that shows which workspace files
 * are included in this chat's context and lets the user toggle them. Visible
 * only when the current thread (or draft) belongs to a workspace that has at
 * least one file.
 *
 * Uses the same custom dropdown pattern as `ModelChooser` (no shadcn Popover
 * dep — the project doesn't install one).
 */

import { useEffect, useRef, useState } from "react";
import { Check, FileText } from "lucide-react";
import { listWorkspaceFiles } from "@/lib/db";
import { useT } from "@/store/i18n";
import { useThreads } from "@/store/threads";
import { cn } from "@/lib/utils";
import type { WorkspaceFile } from "@/types/db";

/** Parse the stored `workspace_files_excluded` JSON to a Set. */
function parseExcluded(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr as string[]);
  } catch {
    /* treat as nothing excluded */
  }
  return new Set();
}

/** Returns the label shown on the trigger button. */
function selectorLabel(
  fileCount: number,
  excluded: Set<string>,
  tFn: ReturnType<typeof useT>,
): string {
  const includedCount = fileCount - excluded.size;
  if (includedCount <= 0) return tFn("workspace.fileSelectorNone");
  if (includedCount === fileCount) return tFn("workspace.fileSelectorAll");
  return tFn("workspace.fileSelectorSome", {
    n: includedCount,
    total: fileCount,
  });
}

export function WorkspaceFileSelector() {
  const t = useT();

  const currentThreadId = useThreads((s) => s.currentThreadId);
  const threads = useThreads((s) => s.threads);
  const draftWorkspaceId = useThreads((s) => s.draftWorkspaceId);
  const draftExcludedFileIds = useThreads((s) => s.draftExcludedFileIds);
  const setExcludedFileIds = useThreads((s) => s.setExcludedFileIds);

  // Derive which workspace (and its files) apply to the current thread/draft.
  const thread = threads.find((t) => t.id === currentThreadId);
  const workspaceId = thread?.workspace_id ?? draftWorkspaceId;

  // Excluded set: from the saved thread row, or from draft state.
  const excluded =
    currentThreadId && thread
      ? parseExcluded(thread.workspace_files_excluded)
      : new Set(draftExcludedFileIds);

  // Load files for the current workspace. Track which workspace id the files
  // were loaded for so that stale results from a previous workspace are
  // discarded at render time (render-time adjustment pattern; avoids calling
  // setState directly inside the effect body per react-hooks/set-state-in-effect).
  const [loadedForId, setLoadedForId] = useState<string | null>(null);
  const [loadedFiles, setLoadedFiles] = useState<WorkspaceFile[]>([]);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    void listWorkspaceFiles(workspaceId).then((f) => {
      if (!cancelled) {
        setLoadedFiles(f);
        setLoadedForId(workspaceId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // Render-time: if the workspace changed and the async load hasn't settled yet,
  // treat as "no files known" (nothing rendered until load resolves).
  const files = loadedForId === workspaceId ? loadedFiles : null;

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

  // Don't render when there's no workspace or files haven't loaded yet.
  if (!workspaceId || files === null) return null;
  // Don't render when the workspace has no files — nothing to select.
  if (files.length === 0) return null;

  const toggleFile = (fileId: string) => {
    const next = new Set(excluded);
    if (next.has(fileId)) {
      next.delete(fileId);
    } else {
      next.add(fileId);
    }
    void setExcludedFileIds([...next]);
  };

  const label = selectorLabel(files.length, excluded, t);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={t("workspace.fileSelector")}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={t("workspace.fileSelectorHint")}
        onClick={handleToggle}
        className={cn(
          "text-muted-foreground hover:text-foreground hover:bg-accent flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
          // Highlight the button when some files are excluded to make it
          // discoverable and signal that the context is not the full set.
          excluded.size > 0 && "text-foreground",
        )}
      >
        <FileText className="size-3.5 shrink-0" aria-hidden />
        <span className="max-w-28 truncate">{label}</span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t("workspace.fileSelector")}
          className={cn(
            "bg-popover text-popover-foreground absolute z-50 min-w-52 max-w-72 rounded-lg p-1 shadow-md ring-1 ring-foreground/10",
            openAbove ? "bottom-full mb-1" : "mt-1",
            "left-0",
          )}
        >
          <p className="text-muted-foreground px-3 py-1.5 text-xs">
            {t("workspace.fileSelectorHint")}
          </p>
          {files.map((file) => {
            const included = !excluded.has(file.id);
            return (
              <button
                key={file.id}
                type="button"
                role="option"
                aria-selected={included}
                onClick={() => toggleFile(file.id)}
                className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm"
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded border",
                    included
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-muted-foreground/40",
                  )}
                >
                  {included && <Check className="size-3" aria-hidden />}
                </span>
                <span className="min-w-0 truncate">{file.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
