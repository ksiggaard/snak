import { type ComponentType } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Models } from "@/components/settings/Models";
import { CustomProviders } from "@/components/settings/CustomProviders";
import { DefaultModel } from "@/components/settings/DefaultModel";
import { Memory } from "@/components/settings/Memory";
import { Bots } from "@/components/settings/Bots";
import { QuickActions } from "@/components/settings/QuickActions";
import { SlashCommands } from "@/components/settings/SlashCommands";
import { BehaviorSettings } from "@/components/settings/Behavior";
import { Appearance } from "@/components/settings/Appearance";
import { Language } from "@/components/settings/Language";
import { McpServers } from "@/components/settings/McpServers";
import { Skills } from "@/components/settings/Skills";
import { Plugins } from "@/components/settings/Plugins";
import { Audio } from "@/components/settings/Audio";
import { PlannerModel } from "@/components/settings/PlannerModel";
import { Updates } from "@/components/settings/Updates";
import { Advanced } from "@/components/settings/Advanced";
import { useSettingsNav } from "@/store/settingsNav";
import type { SettingsCategoryId } from "@/lib/settingsSections";

// id → content component. The category list (labels/icons/order) lives in
// `@/lib/settingsSections` and is rendered by the sidebar "settings" list pane;
// the picker that used to sit here has moved there.
const COMPONENTS: Record<SettingsCategoryId, ComponentType> = {
  models: Models,
  "custom-providers": CustomProviders,
  "default-model": DefaultModel,
  memory: Memory,
  bots: Bots,
  "quick-actions": QuickActions,
  "slash-commands": SlashCommands,
  behavior: BehaviorSettings,
  appearance: Appearance,
  language: Language,
  mcp: McpServers,
  skills: Skills,
  plugins: Plugins,
  audio: Audio,
  planner: PlannerModel,
  updates: Updates,
  advanced: Advanced,
};

export function SettingsView() {
  const category = useSettingsNav((s) => s.category);
  const Active = COMPONENTS[category] ?? Models;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-1 [&>*]:shrink-0">
      <AnimatePresence mode="wait">
        <motion.div
          key={category}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <Active />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
