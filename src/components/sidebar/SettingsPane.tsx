import { SETTINGS_SECTIONS } from "@/lib/settingsSections";
import { useSettingsNav } from "@/store/settingsNav";
import { useView } from "@/store/view";
import { useT } from "@/store/i18n";
import { cn } from "@/lib/utils";

/** Settings categories as a standard list pane (mirrors Chats/Bots/Artifacts).
 *  Selecting a row sets the active category and shows the settings main view. */
export function SettingsPane() {
  const t = useT();
  const category = useSettingsNav((s) => s.category);
  const setCategory = useSettingsNav((s) => s.setCategory);
  const view = useView((s) => s.view);
  const setView = useView((s) => s.setView);

  return (
    <div className="flex flex-col gap-0.5">
      {SETTINGS_SECTIONS.map(({ id, label, Icon }) => {
        const active = view === "settings" && category === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => {
              setCategory(id);
              setView("settings");
            }}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
              active
                ? "bg-primary/10 text-foreground font-medium"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
            )}
          >
            <Icon className="size-4 shrink-0 opacity-70" />
            <span className="truncate">{t(label)}</span>
          </button>
        );
      })}
    </div>
  );
}
