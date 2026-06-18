import { motion } from "framer-motion";
import { SidebarPane } from "./SidebarPane";
import { SidebarResizeHandle } from "./SidebarResizeHandle";
import { useLayout } from "@/store/layout";

/** The inline list pane (wide tier): a resizable, persisted-width column. The
 *  icon rail is a separate sibling rendered by App and stays visible even when
 *  this pane is collapsed. Visibility is controlled by App (tier + sidebarOpen). */
export function Sidebar() {
  const width = useLayout((s) => s.sidebarWidth);

  return (
    <motion.aside
      initial={{ x: -16, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -16, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 25, mass: 0.8 }}
      className="bg-sidebar text-sidebar-foreground relative flex shrink-0 flex-col overflow-hidden rounded-2xl"
      style={{ width }}
    >
      <SidebarPane />
      <SidebarResizeHandle />
    </motion.aside>
  );
}
