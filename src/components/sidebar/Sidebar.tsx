import { FolderPlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/search/SearchField";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarModeSwitch } from "./SidebarModeSwitch";
import { SidebarResizeHandle } from "./SidebarResizeHandle";
import { ChatsPane } from "./ChatsPane";
import { ProjectsPane } from "./ProjectsPane";
import { useThreads } from "@/store/threads";
import { useProjects } from "@/store/projects";
import { useSearch } from "@/store/search";
import { useView } from "@/store/view";
import { useLayout } from "@/store/layout";

/** The sidebar's inner content: chrome header, Chats/Projects mode switch (T24),
 *  search + a mode-appropriate "new" action, then the active pane. Rendered
 *  inside the inline `<aside>` (>= md) or a Sheet overlay (< md, T21). `onClose`
 *  collapses/dismisses the surrounding container. */
export function SidebarContent({ onClose }: { onClose: () => void }) {
  const startNewChat = useThreads((s) => s.startNewChat);
  const createProject = useProjects((s) => s.create);
  const openProject = useProjects((s) => s.open);
  const closeProject = useProjects((s) => s.close);
  const clearSearch = useSearch((s) => s.clear);
  const showChat = useView((s) => s.showChat);
  const mode = useLayout((s) => s.sidebarMode);

  const onNewChat = () => {
    showChat();
    clearSearch();
    closeProject();
    startNewChat();
  };

  const onNewProject = async () => {
    showChat();
    clearSearch();
    const p = await createProject();
    await openProject(p.id);
  };

  return (
    <>
      <SidebarHeader onClose={onClose} />
      <div className="flex flex-col gap-2 px-2 pb-2">
        <SidebarModeSwitch />
        <SearchField />
        {mode === "chats" ? (
          <Button
            className="w-full justify-start"
            variant="outline"
            onClick={onNewChat}
          >
            <Plus className="size-4" />
            New chat
          </Button>
        ) : (
          <Button
            className="w-full justify-start"
            variant="outline"
            onClick={() => void onNewProject()}
          >
            <FolderPlus className="size-4" />
            New project
          </Button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {mode === "chats" ? <ChatsPane /> : <ProjectsPane />}
      </div>
    </>
  );
}

/** The inline sidebar (>= md): a resizable, persisted-width column (T22). Below
 *  md it's hidden — App renders the same content in an overlay Sheet (T21). */
export function Sidebar() {
  const width = useLayout((s) => s.sidebarWidth);
  const toggleSidebar = useLayout((s) => s.toggleSidebar);

  return (
    <aside
      className="bg-sidebar text-sidebar-foreground border-sidebar-border relative hidden shrink-0 flex-col border-r md:flex"
      style={{ width }}
    >
      <SidebarContent onClose={toggleSidebar} />
      <SidebarResizeHandle />
    </aside>
  );
}
