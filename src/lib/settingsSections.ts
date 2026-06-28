import {
  Bot,
  Boxes,
  Brain,
  Languages,
  ListTodo,
  Palette,
  Plug,
  Puzzle,
  Server,
  SlidersHorizontal,
  Sparkles,
  SquareSlash,
  Star,
  Volume2,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { MessageKey } from "@/store/i18n";

/** Settings categories. Previously a left-nav picker inside SettingsView; now
 *  the source of truth for the sidebar "settings" list pane (the rows the user
 *  clicks) and SettingsView's id→component lookup. Order here is the list order. */
export type SettingsCategoryId =
  | "models"
  | "custom-providers"
  | "default-model"
  | "memory"
  | "bots"
  | "quick-actions"
  | "slash-commands"
  | "behavior"
  | "appearance"
  | "language"
  | "mcp"
  | "skills"
  | "plugins"
  | "audio"
  | "planner"
  | "advanced";

export interface SettingsSection {
  id: SettingsCategoryId;
  /** i18n key, resolved at render so the label switches language live. */
  label: MessageKey;
  Icon: LucideIcon;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "models", label: "settings.nav.models", Icon: Boxes },
  {
    id: "custom-providers",
    label: "settings.nav.customProviders",
    Icon: Plug,
  },
  { id: "default-model", label: "settings.nav.defaultModel", Icon: Star },
  { id: "memory", label: "settings.nav.memory", Icon: Brain },
  { id: "bots", label: "settings.nav.bots", Icon: Bot },
  { id: "quick-actions", label: "settings.nav.quickActions", Icon: Zap },
  {
    id: "slash-commands",
    label: "settings.nav.slashCommands",
    Icon: SquareSlash,
  },
  { id: "behavior", label: "settings.nav.behavior", Icon: SlidersHorizontal },
  { id: "appearance", label: "settings.nav.appearance", Icon: Palette },
  { id: "language", label: "settings.nav.language", Icon: Languages },
  { id: "mcp", label: "settings.nav.mcp", Icon: Server },
  { id: "skills", label: "settings.nav.skills", Icon: Sparkles },
  { id: "plugins", label: "settings.nav.plugins", Icon: Puzzle },
  { id: "audio", label: "settings.nav.audio", Icon: Volume2 },
  { id: "planner", label: "settings.nav.planner", Icon: ListTodo },
  { id: "advanced", label: "settings.nav.advanced", Icon: Wrench },
];
