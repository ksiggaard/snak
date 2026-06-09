import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchField } from "@/components/search/SearchField";
import { useThreads } from "@/store/threads";
import { useProjects } from "@/store/projects";
import { useSearch } from "@/store/search";
import { confirmDialog } from "@/store/confirm";
import { PROVIDERS } from "@/lib/providers";
import { cn } from "@/lib/utils";
import type { Provider, Thread } from "@/types/db";

const providerLabel = (p: Provider) =>
  PROVIDERS.find((x) => x.id === p)?.label ?? p;

export function ThreadList() {
  const threads = useThreads((s) => s.threads);
  const currentId = useThreads((s) => s.currentThreadId);
  const selectThread = useThreads((s) => s.selectThread);
  const startNewChat = useThreads((s) => s.startNewChat);
  const startNewChatInProject = useThreads((s) => s.startNewChatInProject);
  const rename = useThreads((s) => s.rename);
  const remove = useThreads((s) => s.remove);

  const projects = useProjects((s) => s.projects);
  const openProjectId = useProjects((s) => s.openProjectId);
  const createProject = useProjects((s) => s.create);
  const openProject = useProjects((s) => s.open);
  const closeProject = useProjects((s) => s.close);
  const removeProject = useProjects((s) => s.remove);

  const clearSearch = useSearch((s) => s.clear);

  // Selecting or starting a chat returns the main pane to the chat view: close
  // any open project pane AND dismiss the search results overlay.
  const goToChat = () => {
    clearSearch();
    closeProject();
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  function beginEdit(id: string, title: string) {
    setEditingId(id);
    setDraft(title);
  }

  async function commitEdit() {
    if (editingId) await rename(editingId, draft);
    setEditingId(null);
  }

  async function onNewProject() {
    const p = await createProject();
    await openProject(p.id);
  }

  const ungrouped = threads.filter((t) => !t.project_id);

  function renderThread(t: Thread) {
    const active = t.id === currentId;
    return (
      <div
        key={t.id}
        className={cn(
          "group flex items-center gap-1 rounded-md px-2 py-1.5",
          active ? "bg-accent" : "hover:bg-accent/50",
        )}
      >
        {editingId === t.id ? (
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitEdit();
              if (e.key === "Escape") setEditingId(null);
            }}
            className="h-7 text-sm"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              goToChat();
              void selectThread(t.id);
            }}
            onDoubleClick={() => beginEdit(t.id, t.title)}
            className="min-w-0 flex-1 text-left"
            title="Double-click to rename"
          >
            <div className="truncate text-sm">{t.title}</div>
            <div className="text-muted-foreground truncate text-xs">
              {providerLabel(t.provider)}
            </div>
          </button>
        )}
        <button
          type="button"
          aria-label="Delete conversation"
          onClick={() => {
            void confirmDialog({
              title: `Delete "${t.title}"?`,
              confirmText: "Delete",
              destructive: true,
            }).then((ok) => {
              if (ok) void remove(t.id);
            });
          }}
          className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 group-hover:opacity-100"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <aside className="bg-card flex w-64 flex-col border-r">
      <div className="flex flex-col gap-2 p-2">
        <SearchField />
        <Button
          className="w-full justify-start"
          variant="outline"
          onClick={() => {
            goToChat();
            startNewChat();
          }}
        >
          <Plus className="size-4" />
          New chat
        </Button>
        <Button
          className="w-full justify-start"
          variant="ghost"
          onClick={() => void onNewProject()}
        >
          <FolderPlus className="size-4" />
          New project
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {threads.length === 0 && projects.length === 0 && (
          <p className="text-muted-foreground px-2 py-4 text-xs">
            No conversations yet.
          </p>
        )}

        {projects.map((project) => {
          const isCollapsed = collapsed[project.id];
          const projectThreads = threads.filter(
            (t) => t.project_id === project.id,
          );
          const isOpen = openProjectId === project.id;
          return (
            <div key={project.id} className="mb-1">
              <div
                className={cn(
                  "group flex items-center gap-1 rounded-md px-1.5 py-1.5",
                  isOpen ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                <button
                  type="button"
                  aria-label={
                    isCollapsed ? "Expand project" : "Collapse project"
                  }
                  onClick={() =>
                    setCollapsed((c) => ({
                      ...c,
                      [project.id]: !c[project.id],
                    }))
                  }
                  className="text-muted-foreground shrink-0"
                >
                  {isCollapsed ? (
                    <ChevronRight className="size-4" />
                  ) : (
                    <ChevronDown className="size-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void openProject(project.id)}
                  className="min-w-0 flex-1 truncate text-left text-sm font-medium"
                  title="Open project"
                >
                  {project.name}
                </button>
                <button
                  type="button"
                  aria-label="New chat in project"
                  onClick={() => {
                    goToChat();
                    startNewChatInProject(project.id);
                  }}
                  className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 group-hover:opacity-100"
                  title="New chat in project"
                >
                  <Plus className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Edit project"
                  onClick={() => void openProject(project.id)}
                  className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 group-hover:opacity-100"
                  title="Edit project"
                >
                  <Settings2 className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Delete project"
                  onClick={() => {
                    void confirmDialog({
                      title: `Delete project "${project.name}"?`,
                      description:
                        "Its chats are kept (moved out of the project).",
                      confirmText: "Delete",
                      destructive: true,
                    }).then((ok) => {
                      if (ok) void removeProject(project.id);
                    });
                  }}
                  className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              {!isCollapsed && (
                <div className="ml-3 border-l pl-1">
                  {projectThreads.length === 0 ? (
                    <p className="text-muted-foreground px-2 py-1 text-xs">
                      No chats yet.
                    </p>
                  ) : (
                    projectThreads.map(renderThread)
                  )}
                </div>
              )}
            </div>
          );
        })}

        {projects.length > 0 && ungrouped.length > 0 && (
          <p className="text-muted-foreground mt-2 px-2 py-1 text-xs font-medium">
            Other chats
          </p>
        )}
        {ungrouped.map(renderThread)}
      </div>
    </aside>
  );
}
