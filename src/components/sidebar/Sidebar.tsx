import { SidebarPane } from "./SidebarPane";
import { SidebarResizeHandle } from "./SidebarResizeHandle";
import { useLayout } from "@/store/layout";

/** The inline list pane (wide tier): a resizable, persisted-width column. The
 *  icon rail is a separate sibling rendered by App and stays visible even when
 *  this pane is collapsed. Visibility is controlled by App (tier + sidebarOpen). */
export function Sidebar() {
  const width = useLayout((s) => s.sidebarWidth);

  return (
    <aside
      className="bg-sidebar text-sidebar-foreground border-sidebar-border animate-in slide-in-from-left-4 fade-in-0 relative flex shrink-0 flex-col border-r duration-200"
      style={{ width }}
    >
      <SidebarPane />
      <SidebarResizeHandle />
    </aside>
  );
}
