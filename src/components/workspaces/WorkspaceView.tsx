import { useRef, useState } from "react";
import { FileText, Globe, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { QuickActionsEditor } from "@/components/settings/QuickActionsEditor";
import { useWorkspaces } from "@/store/workspaces";
import { t as tNow, useT, useTp } from "@/store/i18n";
import { classifyFile, extractDocumentText } from "@/lib/documents";
import {
  WORKSPACE_CONTEXT_CHAR_BUDGET,
  workspaceFilesSize,
} from "@/lib/workspaces";
import { fetchUrlAsMarkdown, validateUrl } from "@/lib/url";
import {
  parseQuickActions,
  serializeQuickActions,
  type QuickAction,
} from "@/lib/quickActions";

/** Max size (chars) for a single uploaded workspace file. */
const MAX_FILE_CHARS = 200_000;

export function WorkspaceView() {
  const t = useT();
  const tp = useTp();
  const openWorkspaceId = useWorkspaces((s) => s.openWorkspaceId);
  const workspaces = useWorkspaces((s) => s.workspaces);
  const files = useWorkspaces((s) => s.openWorkspaceFiles);
  const rename = useWorkspaces((s) => s.rename);
  const setInstructions = useWorkspaces((s) => s.setInstructions);
  const setQuickActions = useWorkspaces((s) => s.setQuickActions);
  const addFile = useWorkspaces((s) => s.addFile);
  const removeFile = useWorkspaces((s) => s.removeFile);

  const workspace = workspaces.find((w) => w.id === openWorkspaceId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  // URL ingestion state (T59).
  const [urlDraft, setUrlDraft] = useState("");
  const [urlFetching, setUrlFetching] = useState(false);

  // Local drafts so typing doesn't write to the DB on each keystroke; re-synced
  // at render when the open workspace changes (render-time sync pattern, not an
  // effect — matches ModelPicker).
  const [nameDraft, setNameDraft] = useState(workspace?.name ?? "");
  const [instrDraft, setInstrDraft] = useState(workspace?.instructions ?? "");
  const [qaDraft, setQaDraft] = useState<QuickAction[]>(() =>
    parseQuickActions(workspace?.quick_actions),
  );
  const [syncedId, setSyncedId] = useState(openWorkspaceId);
  if (openWorkspaceId !== syncedId) {
    setSyncedId(openWorkspaceId);
    setNameDraft(workspace?.name ?? "");
    setInstrDraft(workspace?.instructions ?? "");
    setQaDraft(parseQuickActions(workspace?.quick_actions));
    setError(null);
    setUrlDraft("");
  }

  if (!workspace) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
        {t("workspace.notFound")}
      </div>
    );
  }

  const filesSize = workspaceFilesSize(files);
  const overBudget = filesSize > WORKSPACE_CONTEXT_CHAR_BUDGET;
  // Quick-actions override is dirty vs. what's stored (normalized through the
  // parser so "" and "[]" both compare equal to an empty draft).
  const qaDirty =
    serializeQuickActions(qaDraft) !==
    serializeQuickActions(parseQuickActions(workspace.quick_actions));

  async function onPickFiles(list: FileList | null) {
    if (!list || !workspace) return;
    setError(null);
    for (const file of Array.from(list)) {
      // T39: binary documents (PDF/Office) are text-extracted in the backend
      // and then follow the same char-cap path as plain text files. Legacy
      // Office / unsupported (incl. image) files are surfaced, never dropped.
      const cls = classifyFile(file.name, file.type);
      if (cls === "legacy-document") {
        setError(tNow("composer.documentLegacy", { name: file.name }));
        continue;
      }
      if (cls === "image" || cls === "unsupported") {
        setError(tNow("composer.documentUnsupported", { name: file.name }));
        continue;
      }
      try {
        const text =
          cls === "binary-document"
            ? await extractDocumentText(file)
            : await file.text();
        const content =
          text.length > MAX_FILE_CHARS ? text.slice(0, MAX_FILE_CHARS) : text;
        await addFile(workspace.id, file.name, content);
        if (text.length > MAX_FILE_CHARS) {
          setError(
            tNow("workspace.truncated", {
              name: file.name,
              n: MAX_FILE_CHARS.toLocaleString(),
            }),
          );
        }
      } catch (err) {
        // The extractor rejects with a user-readable string; webview reads
        // fail without one — keep the generic notice for those.
        if (cls === "binary-document") {
          setError(
            tNow("composer.documentReadError", {
              name: file.name,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        } else {
          setError(tNow("workspace.readError", { name: file.name }));
        }
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function onAddUrl() {
    if (!workspace || urlFetching) return;
    const urlTrimmed = urlDraft.trim();
    const validationError = validateUrl(urlTrimmed);
    if (validationError) {
      setError(tNow("workspace.urlInvalid", { error: validationError }));
      return;
    }
    setError(null);
    setUrlFetching(true);
    try {
      const { title, markdown } = await fetchUrlAsMarkdown(urlTrimmed);
      // Derive a filename: use the page title (sanitised) or hostname.
      const hostname = urlTrimmed.replace(/^https?:\/\//, "").split(/[/?]/)[0] ?? "page";
      const baseName = title.trim() || hostname;
      const safeName = baseName.replace(/[/\\:*?"<>|]/g, "-").slice(0, 80);
      const name = `${safeName}.md`;
      await addFile(workspace.id, name, markdown, urlTrimmed);
      setUrlDraft("");
    } catch (err) {
      setError(
        tNow("workspace.urlError", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setUrlFetching(false);
    }
  }

  return (
    <div className="bg-card flex flex-1 flex-col gap-5 overflow-y-auto rounded-lg border p-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="workspace-name">{t("workspace.name")}</Label>
        <Input
          id="workspace-name"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => {
            if (nameDraft.trim() && nameDraft !== workspace.name)
              void rename(workspace.id, nameDraft);
          }}
          className="max-w-md"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="workspace-instructions">
          {t("workspace.instructions")}
        </Label>
        <p className="text-muted-foreground text-xs">
          {t("workspace.instructionsHint")}
        </p>
        <Textarea
          id="workspace-instructions"
          value={instrDraft}
          onChange={(e) => setInstrDraft(e.target.value)}
          onBlur={() => {
            if (instrDraft !== workspace.instructions)
              void setInstructions(workspace.id, instrDraft);
          }}
          rows={6}
          placeholder={t("workspace.instructionsPlaceholder")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>{t("workspace.files")}</Label>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-4" />
              {t("workspace.addFiles")}
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void onPickFiles(e.target.files)}
          />
        </div>

        {/* URL ingestion (T59) */}
        <div className="flex gap-2">
          <Input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder={t("workspace.urlPlaceholder")}
            disabled={urlFetching}
            className="min-w-0 flex-1 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") void onAddUrl();
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void onAddUrl()}
            disabled={urlFetching || !urlDraft.trim()}
          >
            {urlFetching ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("workspace.urlFetching")}
              </>
            ) : (
              <>
                <Globe className="size-4" />
                {t("workspace.addUrl")}
              </>
            )}
          </Button>
        </div>
        <p
          className={
            overBudget
              ? "text-destructive text-xs"
              : "text-muted-foreground text-xs"
          }
        >
          {tp("workspace.fileCount", files.length)} ·{" "}
          {t("workspace.chars", {
            used: filesSize.toLocaleString(),
            budget: WORKSPACE_CONTEXT_CHAR_BUDGET.toLocaleString(),
          })}
          {overBudget && ` ${t("workspace.overBudget")}`}
        </p>

        {files.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {t("workspace.noFiles")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {files.map((f) => (
              <li
                key={f.id}
                className="hover:bg-accent/50 flex flex-col rounded-md px-2 py-1.5 text-sm"
              >
                <div className="flex items-center gap-2">
                  {f.source_url ? (
                    <Globe className="text-muted-foreground size-4 shrink-0" />
                  ) : (
                    <FileText className="text-muted-foreground size-4 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {f.content.length.toLocaleString()}
                  </span>
                  <button
                    type="button"
                    aria-label={t("workspace.removeFile", { name: f.name })}
                    onClick={() => void removeFile(f.id)}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                {f.source_url && (
                  <a
                    href={f.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground ml-6 truncate text-xs underline underline-offset-2"
                    title={f.source_url}
                  >
                    {t("workspace.sourceUrl", { url: f.source_url })}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("workspace.quickActions")}</Label>
        <p className="text-muted-foreground text-xs">
          {t("workspace.quickActionsHint")}
        </p>
        {qaDraft.length === 0 && (
          <p className="text-muted-foreground text-xs">
            {t("workspace.quickActionsUsingGlobal")}
          </p>
        )}
        <QuickActionsEditor actions={qaDraft} onChange={setQaDraft} />
        {qaDirty && (
          <div>
            <Button
              size="sm"
              onClick={() =>
                void setQuickActions(
                  workspace.id,
                  qaDraft.length ? serializeQuickActions(qaDraft) : "",
                )
              }
            >
              {t("common.save")}
            </Button>
          </div>
        )}
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
