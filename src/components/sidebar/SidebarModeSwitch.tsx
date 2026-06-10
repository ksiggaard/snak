import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLayout } from "@/store/layout";

/** Segmented Chats / Projects switch (T24). Persists via the layout store. */
export function SidebarModeSwitch() {
  const mode = useLayout((s) => s.sidebarMode);
  const setMode = useLayout((s) => s.setSidebarMode);

  return (
    <ToggleGroup
      type="single"
      value={mode}
      onValueChange={(v) => {
        // Radix fires "" when the active item is re-clicked; ignore to keep a
        // mode always selected.
        if (v === "chats" || v === "projects") setMode(v);
      }}
      variant="outline"
      size="sm"
      className="w-full"
    >
      <ToggleGroupItem value="chats" className="flex-1">
        Chats
      </ToggleGroupItem>
      <ToggleGroupItem value="projects" className="flex-1">
        Projects
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
