import { useRef, useState } from "react";
import { FileText, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useProjects } from "@/store/projects";
import { PROJECT_CONTEXT_CHAR_BUDGET, projectFilesSize } from "@/lib/projects";

/** Max size (chars) for a single uploaded project file. */
const MAX_FILE_CHARS = 200_000;

export function ProjectView() {
  const openProjectId = useProjects((s) => s.openProjectId);
  const projects = useProjects((s) => s.projects);
  const files = useProjects((s) => s.openProjectFiles);
  const rename = useProjects((s) => s.rename);
  const setInstructions = useProjects((s) => s.setInstructions);
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
  const [syncedId, setSyncedId] = useState(openProjectId);
  if (openProjectId !== syncedId) {
    setSyncedId(openProjectId);
    setNameDraft(project?.name ?? "");
    setInstrDraft(project?.instructions ?? "");
    setError(null);
  }

  if (!project) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
        Project not found.
      </div>
    );
  }

  const filesSize = projectFilesSize(files);
  const overBudget = filesSize > PROJECT_CONTEXT_CHAR_BUDGET;

  async function onPickFiles(list: FileList | null) {
    if (!list || !project) return;
    setError(null);
    for (const file of Array.from(list)) {
      try {
        const text = await file.text();
        const content =
          text.length > MAX_FILE_CHARS ? text.slice(0, MAX_FILE_CHARS) : text;
        await addFile(project.id, file.name, content);
        if (text.length > MAX_FILE_CHARS) {
          setError(
            `"${file.name}" was truncated to ${MAX_FILE_CHARS.toLocaleString()} characters.`,
          );
        }
      } catch {
        setError(`Couldn't read "${file.name}" as text.`);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="bg-card flex flex-1 flex-col gap-5 overflow-y-auto rounded-lg border p-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-name">Project name</Label>
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
        <Label htmlFor="project-instructions">Instructions</Label>
        <p className="text-muted-foreground text-xs">
          Shared context added to every chat in this project.
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
          placeholder="e.g. You are helping with the Acme codebase. Prefer TypeScript…"
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>Files</Label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="size-4" />
            Add files
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
          {files.length} file{files.length === 1 ? "" : "s"} ·{" "}
          {filesSize.toLocaleString()} /{" "}
          {PROJECT_CONTEXT_CHAR_BUDGET.toLocaleString()} chars
          {overBudget && " — over budget; excess is truncated when sending."}
        </p>

        {files.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No files yet. Text files are added as reference context.
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
                  aria-label={`Remove ${f.name}`}
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

      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
