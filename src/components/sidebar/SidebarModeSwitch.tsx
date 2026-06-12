import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLayout } from "@/store/layout";
import { useT } from "@/store/i18n";

/** Segmented Chats / Projects / Bots switch (T24, T38). Persists via the
 *  layout store. */
export function SidebarModeSwitch() {
  const t = useT();
  const mode = useLayout((s) => s.sidebarMode);
  const setMode = useLayout((s) => s.setSidebarMode);

  return (
    <ToggleGroup
      type="single"
      value={mode}
      onValueChange={(v) => {
        // Radix fires "" when the active item is re-clicked; ignore to keep a
        // mode always selected.
        if (v === "chats" || v === "projects" || v === "bots") setMode(v);
      }}
      variant="outline"
      size="sm"
      className="w-full"
    >
      <ToggleGroupItem value="chats" className="flex-1">
        {t("sidebar.chats")}
      </ToggleGroupItem>
      <ToggleGroupItem value="projects" className="flex-1">
        {t("sidebar.projects")}
      </ToggleGroupItem>
      <ToggleGroupItem value="bots" className="flex-1">
        {t("sidebar.bots")}
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
