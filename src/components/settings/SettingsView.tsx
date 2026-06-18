import { useState, type ComponentType } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Models } from "@/components/settings/Models";
import { Memory } from "@/components/settings/Memory";
import { Bots } from "@/components/settings/Bots";
import { QuickActions } from "@/components/settings/QuickActions";
import { BehaviorSettings } from "@/components/settings/Behavior";
import { Appearance } from "@/components/settings/Appearance";
import { Language } from "@/components/settings/Language";
import { McpServers } from "@/components/settings/McpServers";
import { Skills } from "@/components/settings/Skills";
import { Plugins } from "@/components/settings/Plugins";
import { PlannerModel } from "@/components/settings/PlannerModel";
import { Advanced } from "@/components/settings/Advanced";
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
  {
    id: "models",
    label: "settings.nav.models",
    Component: Models,
  },
  { id: "memory", label: "settings.nav.memory", Component: Memory },
  { id: "bots", label: "settings.nav.bots", Component: Bots },
  {
    id: "quick-actions",
    label: "settings.nav.quickActions",
    Component: QuickActions,
  },
  { id: "behavior", label: "settings.nav.behavior", Component: BehaviorSettings },
  { id: "appearance", label: "settings.nav.appearance", Component: Appearance },
  { id: "language", label: "settings.nav.language", Component: Language },
  { id: "mcp", label: "settings.nav.mcp", Component: McpServers },
  { id: "skills", label: "settings.nav.skills", Component: Skills },
  { id: "plugins", label: "settings.nav.plugins", Component: Plugins },
  { id: "planner", label: "settings.nav.planner", Component: PlannerModel },
  { id: "advanced", label: "settings.nav.advanced", Component: Advanced },
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
              "shrink-0 rounded-md px-3 py-2 text-left text-sm whitespace-nowrap transition-all duration-200",
              s.id === activeId
                ? "bg-accent text-accent-foreground font-medium shadow-sm"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground hover:scale-[1.02]",
            )}
          >
            {t(s.label)}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto py-1 [&>*]:shrink-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeId}
            initial={{ opacity: 0, y: 8, filter: "blur(2px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(2px)" }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <Active />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
