import { useRef, useState } from "react";
import { FileText, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { QuickActionsEditor } from "@/components/settings/QuickActionsEditor";
import { useProjects } from "@/store/projects";
import { t as tNow, useT, useTp } from "@/store/i18n";
import { classifyFile, extractDocumentText } from "@/lib/documents";
import { PROJECT_CONTEXT_CHAR_BUDGET, projectFilesSize } from "@/lib/projects";
import {
  parseQuickActions,
  serializeQuickActions,
  type QuickAction,
} from "@/lib/quickActions";

/** Max size (chars) for a single uploaded project file. */
const MAX_FILE_CHARS = 200_000;

export function ProjectView() {
  const t = useT();
  const tp = useTp();
  const openProjectId = useProjects((s) => s.openProjectId);
  const projects = useProjects((s) => s.projects);
  const files = useProjects((s) => s.openProjectFiles);
  const rename = useProjects((s) => s.rename);
  const setInstructions = useProjects((s) => s.setInstructions);
  const setQuickActions = useProjects((s) => s.setQuickActions);
  const addFile = useProjects((s) => s.addFile);
  const removeFile = useProjects((s) => s.removeFile);

  const project = projects.find((p) => p.id === openProjectId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Local drafts so typing doesn't write to the DB on each keystroke; re-synced
  // at render when the open project changes (render-time sync pattern, not an
  // effect — matches ModelPicker).
  const [nameDraft, setNameDraft] = useState(project?.name ?? "");
  const [instrDraft, setInstrDraft] = useState(project?.instructions ?? "");
  const [qaDraft, setQaDraft] = useState<QuickAction[]>(() =>
    parseQuickActions(project?.quick_actions),
  );
  const [syncedId, setSyncedId] = useState(openProjectId);
  if (openProjectId !== syncedId) {
    setSyncedId(openProjectId);
    setNameDraft(project?.name ?? "");
    setInstrDraft(project?.instructions ?? "");
    setQaDraft(parseQuickActions(project?.quick_actions));
    setError(null);
  }

  if (!project) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
        {t("project.notFound")}
      </div>
    );
  }

  const filesSize = projectFilesSize(files);
  const overBudget = filesSize > PROJECT_CONTEXT_CHAR_BUDGET;
  // Quick-actions override is dirty vs. what's stored (normalized through the
  // parser so "" and "[]" both compare equal to an empty draft).
  const qaDirty =
    serializeQuickActions(qaDraft) !==
    serializeQuickActions(parseQuickActions(project.quick_actions));

  async function onPickFiles(list: FileList | null) {
    if (!list || !project) return;
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
        await addFile(project.id, file.name, content);
        if (text.length > MAX_FILE_CHARS) {
          setError(
            tNow("project.truncated", {
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
          setError(tNow("project.readError", { name: file.name }));
        }
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="bg-card flex flex-1 flex-col gap-5 overflow-y-auto rounded-lg border p-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-name">{t("project.name")}</Label>
        <Input
          id="project-name"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => {
            if (nameDraft.trim() && nameDraft !== project.name)
              void rename(project.id, nameDraft);
          }}
          className="max-w-md"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-instructions">
          {t("project.instructions")}
        </Label>
        <p className="text-muted-foreground text-xs">
          {t("project.instructionsHint")}
        </p>
        <Textarea
          id="project-instructions"
          value={instrDraft}
          onChange={(e) => setInstrDraft(e.target.value)}
          onBlur={() => {
            if (instrDraft !== project.instructions)
              void setInstructions(project.id, instrDraft);
          }}
          rows={6}
          placeholder={t("project.instructionsPlaceholder")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>{t("project.files")}</Label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="size-4" />
            {t("project.addFiles")}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void onPickFiles(e.target.files)}
          />
        </div>
        <p
          className={
            overBudget
              ? "text-destructive text-xs"
              : "text-muted-foreground text-xs"
          }
        >
          {tp("project.fileCount", files.length)} ·{" "}
          {t("project.chars", {
            used: filesSize.toLocaleString(),
            budget: PROJECT_CONTEXT_CHAR_BUDGET.toLocaleString(),
          })}
          {overBudget && ` ${t("project.overBudget")}`}
        </p>

        {files.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {t("project.noFiles")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {files.map((f) => (
              <li
                key={f.id}
                className="hover:bg-accent/50 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
              >
                <FileText className="text-muted-foreground size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-muted-foreground text-xs">
                  {f.content.length.toLocaleString()}
                </span>
                <button
                  type="button"
                  aria-label={t("project.removeFile", { name: f.name })}
                  onClick={() => void removeFile(f.id)}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("project.quickActions")}</Label>
        <p className="text-muted-foreground text-xs">
          {t("project.quickActionsHint")}
        </p>
        {qaDraft.length === 0 && (
          <p className="text-muted-foreground text-xs">
            {t("project.quickActionsUsingGlobal")}
          </p>
        )}
        <QuickActionsEditor actions={qaDraft} onChange={setQaDraft} />
        {qaDirty && (
          <div>
            <Button
              size="sm"
              onClick={() =>
                void setQuickActions(
                  project.id,
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
