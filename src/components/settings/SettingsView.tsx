import { useState, type ComponentType } from "react";
import { ApiKeys } from "@/components/settings/ApiKeys";
import { DefaultModel } from "@/components/settings/DefaultModel";
import { Models } from "@/components/settings/Models";
import { OllamaSettings } from "@/components/settings/OllamaSettings";
import { Memory } from "@/components/settings/Memory";
import { Bots } from "@/components/settings/Bots";
import { ShortcutSetting } from "@/components/settings/Shortcut";
import { CloseToTraySetting } from "@/components/settings/CloseToTray";
import { Appearance } from "@/components/settings/Appearance";
import { Language } from "@/components/settings/Language";
import { McpServers } from "@/components/settings/McpServers";
import { Skills } from "@/components/settings/Skills";
import { Plugins } from "@/components/settings/Plugins";
import { useT, type MessageKey } from "@/store/i18n";
import { cn } from "@/lib/utils";

interface Section {
  id: string;
  /** i18n key for the nav label (resolved at render so it switches live). */
  label: MessageKey;
  Component: ComponentType;
}

// Each settings card becomes a navigable section. One is shown at a time, so a
// card has the full width/height of the content pane instead of being stacked
// and clipped — see the left-nav layout below.
const SECTIONS: Section[] = [
  { id: "api-keys", label: "settings.nav.apiKeys", Component: ApiKeys },
  {
    id: "default-model",
    label: "settings.nav.defaultModel",
    Component: DefaultModel,
  },
  { id: "models", label: "settings.nav.models", Component: Models },
  { id: "ollama", label: "settings.nav.ollama", Component: OllamaSettings },
  { id: "memory", label: "settings.nav.memory", Component: Memory },
  { id: "bots", label: "settings.nav.bots", Component: Bots },
  {
    id: "shortcut",
    label: "settings.nav.shortcut",
    Component: ShortcutSetting,
  },
  { id: "tray", label: "settings.nav.tray", Component: CloseToTraySetting },
  { id: "appearance", label: "settings.nav.appearance", Component: Appearance },
  { id: "language", label: "settings.nav.language", Component: Language },
  { id: "mcp", label: "settings.nav.mcp", Component: McpServers },
  { id: "skills", label: "settings.nav.skills", Component: Skills },
  { id: "plugins", label: "settings.nav.plugins", Component: Plugins },
];

export function SettingsView() {
  const t = useT();
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const active = SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0];
  const Active = active.Component;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row md:gap-4">
      {/* Section nav: a horizontal scrollable strip on narrow widths, a fixed
          vertical column at >= md (T21). */}
      <nav className="flex shrink-0 gap-0.5 overflow-x-auto pb-1 md:w-44 md:flex-col md:overflow-x-visible md:overflow-y-auto md:pb-0">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActiveId(s.id)}
            className={cn(
              "shrink-0 rounded-md px-3 py-2 text-left text-sm whitespace-nowrap",
              s.id === activeId
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            {t(s.label)}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto py-1 [&>*]:shrink-0">
        <Active />
      </div>
    </div>
  );
}
