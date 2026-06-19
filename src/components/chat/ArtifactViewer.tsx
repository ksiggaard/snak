import { useCallback, useEffect, useState } from "react";
import {
  BookmarkPlus,
  Check,
  Code2,
  Columns2,
  Download,
  Eye,
  ExternalLink,
  FileCode,
  Globe,
  Loader2,
  Maximize2,
  Minimize2,
  RotateCw,
  Send,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ARTIFACT_EDITOR_SYSTEM_PROMPT,
  ARTIFACT_SINGLE_FILE_SYSTEM_PROMPT,
  assembleArtifact,
  extractArtifactBlock,
  parseArtifact,
  serializeArtifact,
} from "@/lib/artifacts";
import { exportArtifactZip, openArtifactInBrowser } from "@/lib/artifactExport";
import { cancelStream, chatStream, type ApiMessage } from "@/lib/chat";
import { getArtifact, getThread } from "@/lib/db";
import { ArtifactCodeEditor } from "@/components/chat/ArtifactCodeEditor";
import { ArtifactFrame } from "@/components/chat/ArtifactFrame";
import { useArtifacts } from "@/store/artifacts";
import { useLibrary } from "@/store/library";
import { useT } from "@/store/i18n";
import type { ArtifactFile } from "@/types/db";
import type { Artifact } from "@/types/db";
import type { Provider } from "@/types/db";

type ViewMode = "preview" | "split" | "code";

// The live preview trails edits by this debounce so typing in split mode doesn't
// reload the iframe on every keystroke.
const PREVIEW_DEBOUNCE_MS = 400;

function slug(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "artifact";
}

/**
 * Fullscreen overlay to browse, edit, preview, and export an artifact (reuses
 * the `Canvas` overlay pattern: `fixed inset-0 z-50`, Escape to close). When
 * `artifactId` is set, edits persist through the `useArtifacts` store (so the
 * inline card preview tracks them); otherwise the session is in-memory only
 * (a still-streaming, not-yet-saved artifact).
 */
export function ArtifactViewer({
  artifactId,
  libraryId,
  title,
  files: initialFiles,
  initialTab,
  onClose,
  editProvider,
  editModel,
  onSaveToLibrary,
}: {
  artifactId: string | null;
  libraryId?: string | null;
  title: string;
  files: ArtifactFile[];
  initialTab: ViewMode;
  onClose: () => void;
  editProvider?: Provider;
  editModel?: string;
  onSaveToLibrary?: () => Promise<void>;
}) {
  const t = useT();
  const update = useArtifacts((s) => s.update);
  const updateLibrary = useLibrary((s) => s.update);

  const isLibrary = libraryId != null;
  const effectiveId = libraryId ?? artifactId;

  const [files, setFiles] = useState<ArtifactFile[]>(initialFiles);
  // The preview renders from `previewFiles` (a debounced copy of `files`) so
  // live editing doesn't reload the iframe on every keystroke.
  const [previewFiles, setPreviewFiles] =
    useState<ArtifactFile[]>(initialFiles);
  const [mode, setMode] = useState<ViewMode>(initialTab);
  const [selected, setSelected] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [showAddress, setShowAddress] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
    "idle",
  );

  const showsPreview = mode === "preview" || mode === "split";
  const showsEditor = mode === "code" || mode === "split";

  // Debounce file changes (manual edits and AI streaming) into the preview.
  useEffect(() => {
    const id = window.setTimeout(
      () => setPreviewFiles(files),
      PREVIEW_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(id);
  }, [files]);

  const refreshPreview = () => {
    setPreviewFiles(files);
    setRefreshKey((k) => k + 1);
  };
  // AI editor: a one-shot request that hands the model the current artifact and
  // its instruction, then streams the rewritten artifact back into the preview.
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Per-file AI editor: targets only the selected file.
  const [filePrompt, setFilePrompt] = useState("");
  const [fileGenerating, setFileGenerating] = useState(false);
  const [fileGenError, setFileGenError] = useState<string | null>(null);

  // Close on Escape (exit fullscreen first; ignored mid-generation so a stream
  // isn't orphaned by an accidental close).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || generating) return;
      e.preventDefault();
      if (fullscreen) setFullscreen(false);
      else onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, onClose, generating]);

  const runEdit = useCallback(async () => {
    const instruction = prompt.trim();
    if (!instruction || generating || !effectiveId) return;
    setGenError(null);
    setGenerating(true);
    if (mode === "code") setMode("split");
    try {
      let provider: Provider;
      let model: string;
      let threadId: string | undefined;

      if (isLibrary) {
        provider = editProvider!;
        model = editModel!;
        threadId = undefined;
      } else {
        const art = (await getArtifact(effectiveId)) as Artifact | null;
        const thread = art ? await getThread(art.thread_id) : null;
        if (!thread || !art) throw new Error(t("artifact.editNoThread"));
        provider = thread.provider;
        model = thread.model;
        threadId = thread.id;
      }
      if (!provider || !model) throw new Error(t("artifact.editNoThread"));

      const messages: ApiMessage[] = [
        { role: "system", content: ARTIFACT_EDITOR_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            "Current artifact:\n\n```artifact\n" +
            serializeArtifact(title, files) +
            "\n```\n\nRequested change: " +
            instruction,
        },
      ];
      let acc = "";
      const result = await chatStream(
        provider,
        model,
        messages,
        (e) => {
          if (!e.text) return;
          acc += e.text;
          const live = parseArtifact(extractArtifactBlock(acc) ?? acc);
          if (live && live.files.length) setFiles(live.files);
        },
        threadId ?? "",
      );
      const parsedFinal = parseArtifact(
        extractArtifactBlock(result.content) ?? result.content,
      );
      if (!parsedFinal || !parsedFinal.files.length)
        throw new Error(t("artifact.editNoArtifact"));
      setFiles(parsedFinal.files);
      if (isLibrary) await updateLibrary(effectiveId!, parsedFinal.files);
      else await update(effectiveId!, parsedFinal.files);
      setPrompt("");
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }, [prompt, generating, effectiveId, isLibrary, title, files, update, updateLibrary, t, mode, editProvider, editModel]);

  const runFileEdit = useCallback(async () => {
    const instruction = filePrompt.trim();
    if (!instruction || fileGenerating || generating || !effectiveId) return;
    setFileGenError(null);
    setFileGenerating(true);
    if (mode === "preview") setMode("split");
    try {
      let provider: Provider;
      let model: string;
      let threadId: string | undefined;

      if (isLibrary) {
        provider = editProvider!;
        model = editModel!;
        threadId = undefined;
      } else {
        const art = (await getArtifact(effectiveId)) as Artifact | null;
        const thread = art ? await getThread(art.thread_id) : null;
        if (!thread || !art) throw new Error(t("artifact.editNoThread"));
        provider = thread.provider;
        model = thread.model;
        threadId = thread.id;
      }
      if (!provider || !model) throw new Error(t("artifact.editNoThread"));

      const selectedFile = files[selected];
      if (!selectedFile) throw new Error("No file selected");
      const messages: ApiMessage[] = [
        { role: "system", content: ARTIFACT_SINGLE_FILE_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `Current file (${selectedFile.path}):\n\n\`\`\`artifact\n` +
            serializeArtifact(title, [selectedFile]) +
            `\n\`\`\`\n\nRequested change: ` +
            instruction,
        },
      ];
      let acc = "";
      const result = await chatStream(
        provider,
        model,
        messages,
        (e) => {
          if (!e.text) return;
          acc += e.text;
          const live = parseArtifact(extractArtifactBlock(acc) ?? acc);
          if (live && live.files.length > 0) {
            const match = live.files.find((f) => f.path === selectedFile.path);
            if (match) {
              setFiles((prev) =>
                prev.map((f, i) =>
                  i === selected ? { ...f, content: match.content } : f,
                ),
              );
            }
          }
        },
        threadId ?? "",
      );
      const parsedFinal = parseArtifact(
        extractArtifactBlock(result.content) ?? result.content,
      );
      if (parsedFinal && parsedFinal.files.length > 0) {
        const match = parsedFinal.files.find((f) => f.path === selectedFile.path);
        if (match) {
          setFiles((prev) => {
            const next = prev.map((f, i) =>
              i === selected ? { ...f, content: match.content } : f,
            );
            if (effectiveId) {
              if (isLibrary) void updateLibrary(effectiveId, next);
              else void update(effectiveId, next);
            }
            return next;
          });
          setFilePrompt("");
        }
      }
    } catch (err) {
      setFileGenError(err instanceof Error ? err.message : String(err));
    } finally {
      setFileGenerating(false);
    }
  }, [filePrompt, fileGenerating, generating, effectiveId, isLibrary, selected, files, title, update, updateLibrary, t, mode, editProvider, editModel]);

  const editFile = useCallback(
    (content: string) => {
      setFiles((prev) => {
        const next = prev.map((f, i) =>
          i === selected ? { ...f, content } : f,
        );
        if (effectiveId) {
          if (isLibrary) void updateLibrary(effectiveId, next);
          else void update(effectiveId, next);
        }
        return next;
      });
    },
    [selected, effectiveId, isLibrary, update, updateLibrary],
  );

  const onExport = useCallback(async () => {
    setBusy(true);
    try {
      await exportArtifactZip(files, `${slug(title)}.zip`);
    } catch {
      // Export failure (e.g. dialog/IO) is non-fatal; ignore silently.
    } finally {
      setBusy(false);
    }
  }, [files, title]);

  const onOpenBrowser = useCallback(async () => {
    try {
      await openArtifactInBrowser(assembleArtifact(files));
    } catch {
      // Opening failed (no browser / IO); ignore silently.
    }
  }, [files]);

  const active = files[selected] ?? files[0];

  return (
    <div
      className="bg-background/80 fixed inset-0 z-50 flex flex-col p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t("artifact.viewerAria")}
    >
      <div className="bg-card flex flex-1 flex-col overflow-hidden rounded-lg border shadow-lg">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <FileCode className="text-muted-foreground size-4 shrink-0" />
            <span className="truncate text-sm font-medium">{title}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="bg-muted mr-1 flex items-center rounded-md p-0.5">
              {(
                [
                  { id: "preview", Icon: Eye, label: t("artifact.preview") },
                  { id: "split", Icon: Columns2, label: t("artifact.split") },
                  { id: "code", Icon: Code2, label: t("artifact.code") },
                ] as const
              ).map(({ id, Icon, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-2 py-1 text-xs",
                    mode === id && "bg-background shadow-sm",
                  )}
                >
                  <Icon className="size-3" /> {label}
                </button>
              ))}
            </div>
            {showsPreview && (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("artifact.addressBar")}
                  title={t("artifact.addressBar")}
                  className={cn(showAddress && "text-foreground bg-accent")}
                  onClick={() => setShowAddress((v) => !v)}
                >
                  <Globe className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("artifact.refresh")}
                  title={t("artifact.refresh")}
                  onClick={refreshPreview}
                >
                  <RotateCw className="size-4" />
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("artifact.fullscreen")}
              title={t("artifact.fullscreen")}
              onClick={() => setFullscreen((v) => !v)}
            >
              {fullscreen ? (
                <Minimize2 className="size-4" />
              ) : (
                <Maximize2 className="size-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("artifact.openInBrowser")}
              title={t("artifact.openInBrowser")}
              onClick={() => void onOpenBrowser()}
            >
              <ExternalLink className="size-4" />
            </Button>
            {onSaveToLibrary && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("artifact.saveToLibrary")}
                title={t("artifact.saveToLibrary")}
                disabled={saveStatus !== "idle"}
                onClick={async () => {
                  setSaveStatus("saving");
                  try {
                    await onSaveToLibrary();
                    setSaveStatus("saved");
                    setTimeout(() => setSaveStatus("idle"), 2000);
                  } catch {
                    setSaveStatus("idle");
                  }
                }}
              >
                {saveStatus === "saved" ? (
                  <Check className="size-4 text-green-600 dark:text-green-500" />
                ) : (
                  <BookmarkPlus className="size-4" />
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("artifact.export")}
              title={t("artifact.export")}
              disabled={busy}
              onClick={() => void onExport()}
            >
              <Download className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("artifact.close")}
              onClick={onClose}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Body: file tree + main pane */}
        <div className="flex min-h-0 flex-1">
          {!fullscreen && (
            <div className="bg-muted/30 w-48 shrink-0 overflow-y-auto border-r py-1">
              {files.map((f, i) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => {
                    setSelected(i);
                    if (mode === "preview") setMode("split");
                  }}
                  className={cn(
                    "block w-full truncate px-3 py-1 text-left font-mono text-xs",
                    i === selected
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50",
                  )}
                  title={f.path}
                >
                  {f.path}
                </button>
              ))}
            </div>
          )}

          <div className="flex min-h-0 flex-1">
            {showsEditor && (
              <div
                className={cn(
                  "flex min-h-0 flex-col",
                  mode === "split" ? "w-1/2" : "flex-1",
                )}
              >
                <div className="min-h-0 flex-1">
                  {active ? (
                    <ArtifactCodeEditor
                      path={active.path}
                      value={active.content}
                      onChange={editFile}
                    />
                  ) : null}
                </div>
                {/* Per-file AI editor: edit only the selected file. */}
                {effectiveId && (
                  <div className="border-t px-3 py-2">
                    {fileGenError && (
                      <p className="text-destructive mb-1.5 text-xs">{fileGenError}</p>
                    )}
                    <p className="text-muted-foreground mb-1 text-[11px]">
                      {t("artifact.editingFile", { file: active?.path ?? "" })}
                    </p>
                    <div className="flex items-center gap-2">
                      <Sparkles className="text-muted-foreground size-4 shrink-0" />
                      <input
                        type="text"
                        value={filePrompt}
                        disabled={fileGenerating || generating}
                        onChange={(e) => setFilePrompt(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void runFileEdit();
                          }
                        }}
                        placeholder={t("artifact.editFile", { file: active?.path ?? "" })}
                        className="bg-background min-w-0 flex-1 rounded-md border px-3 py-1.5 text-sm outline-none disabled:opacity-60"
                      />
                      {fileGenerating ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void cancelStream()}
                        >
                          <Square className="size-3.5" /> {t("artifact.editStop")}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={!filePrompt.trim() || generating}
                          onClick={() => void runFileEdit()}
                        >
                          <Send className="size-3.5" /> {t("common.send")}
                        </Button>
                      )}
                    </div>
                    {fileGenerating && (
                      <p className="text-muted-foreground mt-1.5 flex items-center gap-1.5 text-xs">
                        <Loader2 className="size-3 animate-spin" />{" "}
                        {t("artifact.editingFile", { file: active?.path ?? "" })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            {showsPreview && (
              <div
                className={cn(
                  "min-h-0",
                  mode === "split" ? "w-1/2 border-l" : "flex-1",
                )}
              >
                <ArtifactFrame
                  key={refreshKey}
                  files={previewFiles}
                  title={title}
                  showAddressBar={showAddress}
                />
              </div>
            )}
          </div>
        </div>

        {/* AI editor: edit/expand/update the artifact by prompting the model.
            The current artifact is sent each turn, so changes build up. */}
        <div className="border-t px-3 py-2">
          {genError && (
            <p className="text-destructive mb-1.5 text-xs">{genError}</p>
          )}
          <div className="flex items-center gap-2">
            <Sparkles className="text-muted-foreground size-4 shrink-0" />
            <input
              type="text"
              value={prompt}
              disabled={generating || !effectiveId}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void runEdit();
                }
              }}
              placeholder={
                effectiveId
                  ? t("artifact.editPlaceholder")
                  : t("artifact.saving")
              }
              className="bg-background min-w-0 flex-1 rounded-md border px-3 py-1.5 text-sm outline-none disabled:opacity-60"
            />
            {generating ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void cancelStream()}
              >
                <Square className="size-3.5" /> {t("artifact.editStop")}
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={!prompt.trim() || !effectiveId}
                onClick={() => void runEdit()}
              >
                <Send className="size-3.5" /> {t("common.send")}
              </Button>
            )}
          </div>
          {generating && (
            <p className="text-muted-foreground mt-1.5 flex items-center gap-1.5 text-xs">
              <Loader2 className="size-3 animate-spin" />{" "}
              {t("artifact.editing")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
