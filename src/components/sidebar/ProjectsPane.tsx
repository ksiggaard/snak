import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Settings2, Trash2 } from "lucide-react";
import { useThreads } from "@/store/threads";
import { useProjects } from "@/store/projects";
import { useSearch } from "@/store/search";
import { useView } from "@/store/view";
import { confirmDialog } from "@/store/confirm";
import { ThreadRow } from "./ThreadRow";
import { cn } from "@/lib/utils";

/** Projects mode (T24): the project list; opening one shows its detail view in
 *  the main pane and reveals its threads here. */
export function ProjectsPane() {
  const threads = useThreads((s) => s.threads);
  const currentId = useThreads((s) => s.currentThreadId);
  const selectThread = useThreads((s) => s.selectThread);
  const startNewChatInProject = useThreads((s) => s.startNewChatInProject);

  const projects = useProjects((s) => s.projects);
  const openProjectId = useProjects((s) => s.openProjectId);
  const openProject = useProjects((s) => s.open);
  const closeProject = useProjects((s) => s.close);
  const removeProject = useProjects((s) => s.remove);

  const clearSearch = useSearch((s) => s.clear);
  const showChat = useView((s) => s.showChat);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Opening a project shows its detail pane (leave settings/usage).
  const goProject = (id: string) => {
    showChat();
    clearSearch();
    void openProject(id);
  };
  const selectChat = (id: string) => {
    showChat();
    clearSearch();
    closeProject();
    void selectThread(id);
  };
  const newChat = (projectId: string) => {
    showChat();
    clearSearch();
    closeProject();
    startNewChatInProject(projectId);
  };

  if (projects.length === 0) {
    return (
      <p className="text-muted-foreground px-2 py-4 text-xs">
        No projects yet. Create one with “New project”.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {projects.map((project) => {
        const isCollapsed = collapsed[project.id];
        const projectThreads = threads.filter((t) => t.project_id === project.id);
        const isOpen = openProjectId === project.id;
        return (
          <div key={project.id} className="mb-1">
            <div
              className={cn(
                "group flex items-center gap-1 rounded-md px-1.5 py-1.5",
                isOpen ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50",
              )}
            >
              <button
                type="button"
                aria-label={isCollapsed ? "Expand project" : "Collapse project"}
                onClick={() =>
                  setCollapsed((c) => ({ ...c, [project.id]: !c[project.id] }))
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
                onClick={() => goProject(project.id)}
                className="min-w-0 flex-1 truncate text-left text-sm font-medium"
                title="Open project"
              >
                {project.name}
              </button>
              <button
                type="button"
                aria-label="New chat in project"
                onClick={() => newChat(project.id)}
                className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 group-hover:opacity-100"
                title="New chat in project"
              >
                <Plus className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Edit project"
                onClick={() => goProject(project.id)}
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
                    description: "Its chats are kept (moved out of the project).",
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
              <div className="border-sidebar-border ml-3 border-l pl-1">
                {projectThreads.length === 0 ? (
                  <p className="text-muted-foreground px-2 py-1 text-xs">
                    No chats yet.
                  </p>
                ) : (
                  projectThreads.map((t) => (
                    <ThreadRow
                      key={t.id}
                      thread={t}
                      active={t.id === currentId}
                      onSelect={() => selectChat(t.id)}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
