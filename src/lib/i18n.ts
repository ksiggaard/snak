// T32 i18n core: a homegrown, dependency-free message-catalog layer.
//
// ## Mechanism (decision)
// - The **TypeScript English catalog below is the source of truth** for keys
//   and fallback text. `MessageKey` is derived from it, so `t("typo.key")`
//   fails `tsc` — the compiler is the key linter. The bundled `en.json` pack is
//   therefore a *thin* pack (`strings: {}`): English always resolves from this
//   catalog, never from JSON, so the two can't drift.
// - Language packs are plain JSON (`{ name, code, strings }`, one
//   `<bcp47>.json` per language). Bundled packs live in `src/locales/` and are
//   imported statically; user packs are discovered from the app-data
//   `languages/` folder by Rust (`list_languages`, mirroring the T11 themes
//   loader — see `src-tauri/src/commands/languages.rs`).
// - Lookup: active pack string → English catalog. A missing/untranslated key
//   renders the English string, **never the raw key** (the catalog is total
//   over `MessageKey` by construction).
// - Interpolation is `{name}`-style: `t("x", { name: "snak" })`. Unknown
//   placeholders are left intact (visible, debuggable).
// - Plurals: a key family `<base>.one` / `<base>.few` / … / `<base>.other`
//   selected via `Intl.PluralRules` (so e.g. Polish few/many work without any
//   library). English only needs `.one`/`.other`; packs may add the extra
//   CLDR categories their language uses.
//
// This module is **pure** (no Zustand, no Tauri) so it's unit-testable; the
// live store (active locale + merged strings + `t`/`useT`) is
// `src/store/i18n.ts`.

/** English catalog — the canonical key set. Keep keys dotted + namespaced. */
export const en = {
  // --- Common / shared ------------------------------------------------------
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.confirm": "Confirm",
  "common.delete": "Delete",
  "common.remove": "Remove",
  "common.add": "Add",
  "common.update": "Update",
  "common.reset": "Reset",
  "common.refresh": "Refresh",
  "common.loading": "Loading…",
  "common.enabled": "Enabled",
  "common.disabled": "Disabled",
  "common.on": "On",
  "common.off": "Off",
  "common.send": "Send",
  "common.active": "Active",
  "common.use": "Use",
  "common.uninstall": "Uninstall",
  "common.builtIn": "built-in",
  "common.byAuthor": "by {author}",

  // --- Relative time (templates consumed by src/lib/time.ts) ----------------
  "time.justNow": "just now",
  "time.minutesAgo": "{n}m ago",
  "time.hoursAgo": "{n}h ago",
  "time.daysAgo": "{n}d ago",

  // --- Title bar -------------------------------------------------------------
  "titleBar.openSidebar": "Open sidebar",
  "titleBar.hideSidebar": "Hide sidebar",
  "titleBar.showSidebar": "Show sidebar",
  "titleBar.searchChats": "Search chats",
  "titleBar.menu": "Menu",
  "titleBar.settings": "Settings",
  "titleBar.usage": "Usage",
  "titleBar.theme": "Theme",
  "titleBar.themeSystem": "System",
  "titleBar.themeLight": "Light",
  "titleBar.themeDark": "Dark",
  "titleBar.minimize": "Minimize",
  "titleBar.maximize": "Maximize",
  "titleBar.close": "Close",

  // --- In-app menu bar --------------------------------------------------------
  "menu.file": "File",
  "menu.view": "View",
  "menu.newChat": "New Chat",
  "menu.settings": "Settings…",
  "menu.quit": "Quit",
  "menu.searchChats": "Search Chats…",
  "menu.toggleSidebar": "Toggle Sidebar",
  "menu.usage": "Usage",

  // --- Sidebar ----------------------------------------------------------------
  "sidebar.newChat": "New chat",
  "sidebar.newIncognitoChat": "New incognito chat",
  "sidebar.newIncognitoChatTitle":
    "New incognito chat — deleted when the app exits",
  "sidebar.newProject": "New project",
  "sidebar.chats": "Chats",
  "sidebar.projects": "Projects",
  "sidebar.favorites": "Favorites",
  "sidebar.allChats": "All chats",
  "sidebar.archive": "Archive",
  "sidebar.archiveChat": "Close chat (move to Archive)",
  "sidebar.chatMenu": "Chat options",
  "sidebar.moveToProject": "Move to project",
  "sidebar.clearArchive": "Clear archive",
  "sidebar.clearArchiveTitle": "Delete all {count} archived chats?",
  "sidebar.noConversations": "No conversations yet.",
  "sidebar.noProjects": "No projects yet. Create one with “New project”.",
  "sidebar.noChatsInProject": "No chats yet.",
  "sidebar.expandProject": "Expand project",
  "sidebar.collapseProject": "Collapse project",
  "sidebar.openProject": "Open project",
  "sidebar.newChatInProject": "New chat in project",
  "sidebar.editProject": "Edit project",
  "sidebar.deleteProject": "Delete project",
  "sidebar.deleteProjectTitle": 'Delete project "{name}"?',
  "sidebar.deleteProjectDescription":
    "Its chats are kept (moved out of the project).",
  "sidebar.renameHint": "Double-click to rename",
  "sidebar.incognitoRenameHint":
    "Incognito — deleted when the app exits. Double-click to rename",
  "sidebar.incognitoBadge": "Incognito conversation",
  "sidebar.favorite": "Favorite",
  "sidebar.unfavorite": "Unfavorite",
  "sidebar.favoriteAria": "Favorite conversation",
  "sidebar.unfavoriteAria": "Unfavorite conversation",
  "sidebar.deleteConversation": "Delete conversation",
  "sidebar.deleteThreadTitle": 'Delete "{title}"?',
  "sidebar.navigation": "Navigation",
  "sidebar.resize": "Resize sidebar",

  // --- Chat view / message list -----------------------------------------------
  "chat.empty": "Send a message to start the conversation.",
  "chat.thinking": "Thinking…",
  "chat.incognitoHint": "Incognito — this chat is deleted when the app exits.",
  "chat.compacted":
    "Conversation compacted — older messages above are summarized for the model",
  "chat.you": "you",
  "chat.ai": "ai",
  "chat.attachment": "attachment",
  "chat.webPage": "web page",
  "chat.copy": "Copy",
  "chat.copied": "Copied",
  "chat.copyCode": "Copy code",
  "chat.openInTerminal": "Open in terminal",
  "chat.openInTerminalTitle":
    "Open in terminal (staged, not run — review and press Enter)",

  // --- Chat: right-side panel ------------------------------------------------------------------------------------------
  "panel.open": "Open chat panel",
  "panel.close": "Close panel",
  "panel.searchPlaceholder": "Search this chat…",
  "panel.results": "Results",
  "panel.noMatches": "No matches.",
  "panel.myMessages": "Your messages",
  "panel.noMessages": "No messages yet.",
  "panel.media": "Media",
  "panel.noMedia": "No media shared.",
  "panel.goToMessage": "Go to message",
  "panel.tokenSpend": "Token spend",
  "panel.chatSection": "This chat",
  "panel.renamePlaceholder": "Chat title",
  "panel.project": "Project",
  "panel.noProject": "No project",

  // --- Composer -----------------------------------------------------------------
  "composer.placeholder":
    "Type a message…  ( / for commands · Enter to send · Shift+Enter for newline )",
  "composer.attachImage": "Attach image",
  "composer.removeImage": "Remove image",
  "composer.attachmentPreview": "attachment preview",
  "composer.compact": "Compact conversation",
  "composer.compactTitle":
    "Compact conversation — summarize the history so far so future messages send a smaller context",
  "composer.openCanvas": "Open canvas",
  "composer.openCanvasTitle":
    "Open canvas — a larger editor with live Markdown preview",
  "composer.stop": "Stop",
  "composer.stopAria": "Stop generating",
  "composer.providerDisabled":
    "“{provider}” is disabled. Pick another provider above, or re-enable it in Settings → Plugins.",
  "composer.noProviders":
    "No providers are enabled. Enable a provider plugin in Settings → Plugins to start chatting.",
  "composer.noKey":
    "No API key set for {provider}. Add one in Settings to send messages.",
  "composer.imageError":
    "Couldn't process that image — it may be too large or an unsupported format.",
  "composer.terminalUsage": "Usage: /terminal <shell command>",
  "composer.runInTerminal": "Run this in a terminal?",
  "composer.terminalExplain":
    "The command below will be staged in your terminal for review — it is never auto-executed. You press Enter there to run it.",
  "composer.stageInTerminal": "Stage in terminal",
  "composer.pluginBadge": "plugin",
  "composer.terminalOpenError": "Couldn't open a terminal: {error}",
  "composer.pluginCommandNote":
    "The `{command}` command is provided by a plugin but has no built-in action in this host, so it can't run here.",
  "composer.terminalStagedNote":
    "Staged this command in your terminal — review it and press Enter there to run it (it was not auto-executed):",

  // --- Canvas ---------------------------------------------------------------------
  "canvas.title": "Canvas",
  "canvas.subtitle": "Markdown editor with live preview",
  "canvas.aria": "Canvas editor",
  "canvas.close": "Close canvas",
  "canvas.edit": "Edit",
  "canvas.preview": "Preview",
  "canvas.placeholder": "Compose a long Markdown message…",
  "canvas.empty": "Nothing to preview yet.",
  "canvas.hint": "Cmd/Ctrl+Enter to send · Esc to close (draft is kept)",

  // --- Model chooser -----------------------------------------------------------
  "model.choose": "Choose model",
  "model.aria": "Model",
  "model.unavailable": "unavailable",

  // --- Quick-input overlay -------------------------------------------------------
  "quick.placeholder":
    "Ask anything…  (Enter to send, Tab to pick destination, Esc to dismiss)",
  "quick.newChat": "New chat",
  "quick.startChat": "Start chat",
  "quick.destination": "Destination",
  "quick.takeScreenshot": "Take screenshot",

  // --- Search overlay --------------------------------------------------------------
  "search.placeholder": "Search chats…",
  "search.aria": "Search chats",
  "search.clear": "Clear search",
  "search.searching": "Searching…",
  "search.summary": "{matches} in {chats}",
  "search.matches.one": "{n} match",
  "search.matches.other": "{n} matches",
  "search.chats.one": "{n} chat",
  "search.chats.other": "{n} chats",
  "search.noMatches": "No matches for “{query}”.",
  "search.kindTitle": "Title",
  "search.kindUser": "You",
  "search.kindAssistant": "Assistant",

  // --- Usage view --------------------------------------------------------------------
  "usage.loading": "Loading usage…",
  "usage.emptyTitle": "No token usage recorded yet.",
  "usage.emptyHint": "Send a message and usage will appear here.",
  "usage.totalTokens": "Total tokens",
  "usage.input": "Input",
  "usage.output": "Output",
  "usage.responses": "Responses",
  "usage.activity": "Activity (last 12 months)",
  "usage.less": "Less",
  "usage.more": "More",
  "usage.byModel": "By model",
  "usage.model": "Model",
  "usage.provider": "Provider",
  "usage.cache": "Cache",
  "usage.total": "Total",
  "usage.lastUsed": "Last used",
  "usage.noActivity": "No activity",
  "usage.responseCount.one": "{n} response",
  "usage.responseCount.other": "{n} responses",

  // --- Settings: section nav ------------------------------------------------------------
  "settings.nav.apiKeys": "API Keys",
  "settings.nav.defaultModel": "Default Model",
  "settings.nav.models": "Models",
  "settings.nav.memory": "Memory",
  "settings.nav.shortcut": "Shortcut",
  "settings.nav.tray": "Close to Tray",
  "settings.nav.appearance": "Appearance",
  "settings.nav.language": "Language",
  "settings.nav.mcp": "MCP Servers",
  "settings.nav.skills": "Skills",
  "settings.nav.plugins": "Plugins",

  // --- Settings: API keys -------------------------------------------------------------------
  "apiKeys.title": "API keys",
  "apiKeys.description":
    "Keys are stored in your OS keychain and never leave this machine.",
  "apiKeys.noProviders":
    "No providers are enabled. Enable a provider plugin in the Plugins section below to add its API key.",
  "apiKeys.checking": "checking…",
  "apiKeys.saved": "Saved ✓",
  "apiKeys.notSet": "Not set",
  "apiKeys.storedPlaceholder": "•••••••• (stored)",

  // --- Settings: default model ------------------------------------------------------------------
  "defaultModel.title": "Default Model",
  "defaultModel.description":
    "The provider and model new chats (and the quick-input overlay) start with. You can still change it per chat from the top bar, and manage the list in Settings → Models.",
  "defaultModel.none": "No models configured — add some in Settings → Models.",

  // --- Settings: models ----------------------------------------------------------------------------
  "models.title": "Models",
  "models.description":
    "The models offered per provider in the chat picker. Each has a model id (sent to the API) and a friendly label.",
  "models.noProviders":
    "No providers enabled — enable one in Settings → Plugins.",
  "models.noModels": "No models yet — add one below.",
  "models.labelPlaceholder": "Label (e.g. Opus 4.8)",
  "models.idPlaceholder": "model id",

  // --- Settings: memory / system prompt --------------------------------------------------------------
  "memory.title": "System prompt & memory",
  "memory.description":
    "Added to the system context of every chat, ahead of any project instructions (precedence: global → project → thread).",
  "memory.addendumLabel": "System-prompt addendum",
  "memory.addendumPlaceholder":
    "e.g. Always respond in British English and prefer concise answers.",
  "memory.unsaved": "Unsaved changes",
  "memory.aboutYou": "Memory about you",
  "memory.aboutYouHint":
    "Facts and preferences the assistant should remember across chats.",
  "memory.addPlaceholder":
    "Add a memory, e.g. I'm a TypeScript developer working on a desktop app.",

  // --- Settings: global shortcut ----------------------------------------------------------------------
  "shortcut.title": "Global shortcut",
  "shortcut.description":
    "Summon the quick-input overlay from anywhere. Use modifiers like Alt, CmdOrControl, Shift joined with + (e.g. Alt+Space, CmdOrControl+Shift+K).",
  "shortcut.saved": "Shortcut registered ✓",

  // --- Settings: close to tray --------------------------------------------------------------------------
  "tray.title": "Close to tray",
  "tray.description":
    "When on, closing the window hides it to the system tray and the app keeps running for the global shortcut. Quit from the tray menu to exit fully.",
  "tray.hides": "Closing hides to tray",
  "tray.quits": "Closing quits the app",

  // --- Settings: appearance — title bar card ---------------------------------------------------------------
  "appearance.titleBar.title": "Title Bar",
  "appearance.titleBar.description":
    "Use the system's native title bar, or the app's compact one with a choice of window-control placement and style.",
  "appearance.titleBar.label": "Title bar",
  "appearance.titleBar.custom": "Custom",
  "appearance.titleBar.native": "System native",
  "appearance.titleBar.controls": "Window controls",
  "appearance.titleBar.left": "Left",
  "appearance.titleBar.right": "Right",
  "appearance.titleBar.controlStyle": "Control style",
  "appearance.menuBar.label": "Menu bar",
  "appearance.menuBar.native": "System",
  "appearance.menuBar.inline": "Below title bar",
  "appearance.menuBar.hidden": "Hidden",
  "appearance.menuBar.hint":
    "System shows the native menu — on KDE it appears in the global menu when appmenu-gtk-module is installed, otherwise as a bar above the title bar. Below title bar uses the app's own menu instead.",

  // --- Settings: appearance — themes card -----------------------------------------------------------------------
  "themes.title": "Themes",
  "themes.description":
    "Install a theme by dropping a folder (with theme.json + theme.css) into the themes directory, then select it below. Themes recolor the app on top of the light/dark setting. See docs/theming.md to author your own.",
  "themes.default": "Default",
  "themes.defaultMeta": "built-in palette",
  "themes.none": "No installed themes yet.",
  "themes.showFolder": "Show themes folder",
  "themes.directory": "Themes directory:",
  "themes.pluginBadge": "plugin",

  // --- Settings: appearance — colors card ----------------------------------------------------------------------------
  "colors.title": "Colors",
  "colors.description":
    "Custom accent and background colors. Picks apply to the active mode (you are editing the {mode} palette) and override the selected theme; light and dark are stored separately. Text on top of a custom color is adjusted automatically for contrast. A custom background also re-tints the sidebar, title bar, cards, and input fields with matching darker or lighter tones.",
  "colors.light": "light",
  "colors.dark": "dark",
  "colors.accent": "Accent",
  "colors.background": "Background",
  "colors.colorAria": "{label} color",
  "colors.mixColor": "Mix color",
  "colors.contrast": "Surface contrast",
  "colors.resetAll": "Reset all colors",

  // --- Settings: appearance — corners card ------------------------------------------------------------------------------
  "corners.title": "Corners",
  "corners.description":
    "How rounded the window chrome and controls are — cards, buttons, inputs, and popovers all follow. 0 is fully square.",
  "corners.label": "Corner radius",

  // --- Settings: appearance — typography card ------------------------------------------------------------------------------
  "typography.title": "Typography",
  "typography.description":
    "Fonts and sizes, separately for the app UI and chat messages. Listed fonts must be installed on your system; pick Custom… to type any family name. Code blocks keep their monospace font.",
  "typography.uiFont": "UI font",
  "typography.chatFont": "Chat font",
  "typography.uiSize": "UI size",
  "typography.chatSize": "Chat size",
  "typography.default": "Default (Geist)",
  "typography.custom": "Custom…",
  "typography.customPlaceholder": "Font family, e.g. Cantarell",
  "typography.systemDefault": "System default",
  "typography.systemSerif": "System serif",
  "typography.systemMonospace": "System monospace",
  "typography.familyAria": "{label} family",
  "typography.customFamilyAria": "{label} custom family",
  "typography.sizeAria": "{label} in pixels",

  // --- Settings: appearance — chat style card --------------------------------------------------------------------------------
  "chatStyle.title": "Chat style",
  "chatStyle.description":
    "How messages are laid out in a conversation: the default flat view, messenger-style bubbles, a dense compact view, or a document-like reading mode.",
  "chatStyle.layout": "Layout",
  "chatStyle.default": "Default",
  "chatStyle.bubbles": "Bubbles",
  "chatStyle.compact": "Compact",
  "chatStyle.document": "Document",

  // --- Settings: appearance — chat list card -----------------------------------------------------------------------------------
  "chatList.title": "Chat list",
  "chatList.description":
    "What each conversation row in the sidebar shows: just the title, or a second line with the date, model details, or a preview of the last message.",
  "chatList.titleOption": "Title",
  "chatList.titleDate": "Title + date",
  "chatList.detailed": "Detailed",
  "chatList.preview": "Preview",
  "chatList.mockTitle": "Weekend plans",
  "chatList.mockPreview": "Here's the packing list you asked for…",

  // --- Settings: language card ----------------------------------------------------------------------------------------------------
  "language.title": "Language",
  "language.description":
    "The language of the app's interface. Bundled languages ship with the app; add your own by dropping a JSON language pack into the languages folder (see docs/i18n.md). Switching applies immediately.",
  "language.userBadge": "user pack",
  "language.showFolder": "Show languages folder",
  "language.directory": "Languages directory:",

  // --- Settings: MCP servers -----------------------------------------------------------------------------------------------------------
  "mcp.title": "MCP servers",
  "mcp.description":
    "Connect Model Context Protocol servers to give the model tools. The built-in web-browsing server works out of the box. Add custom servers over stdio (a command) or HTTP (a URL). Enabled servers' tools are offered to the model on every message.",
  "mcp.removeTitle": 'Remove "{label}"?',
  "mcp.addCustom": "Add custom server",
  "mcp.labelPlaceholder": "Label (e.g. GitHub)",
  "mcp.addServer": "Add server",
  "mcp.availableTools": "Available tools",
  "mcp.refreshHint": "Refresh to list tools from enabled servers.",

  // --- Settings: skills ---------------------------------------------------------------------------------------------------------------------
  "skills.title": "Skills",
  "skills.description":
    "Skills are reusable instruction packs the model can draw on. Enable a skill to inject its guidance into every chat's system context. Install more by adding skill plugins (see the Plugins card).",
  "skills.none": "No skills installed yet.",

  // --- Settings: plugins ------------------------------------------------------------------------------------------------------------------------
  "plugins.title": "Plugins",
  "plugins.description":
    "Extend the app with providers, themes, skills, and slash commands. Built-in plugins ship with the app and can be disabled but not removed. User plugins live in the app data plugins/ folder.",
  "plugins.category.provider": "Providers",
  "plugins.category.theme": "Themes",
  "plugins.category.skill": "Skills",
  "plugins.category.slashCommand": "Slash commands",
  "plugins.noneInCategory": "No {category} installed.",
  "plugins.uninstallTitle": 'Uninstall "{name}"?',

  // --- Project view ----------------------------------------------------------------------------------------------------------------------------------
  "project.notFound": "Project not found.",
  "project.name": "Project name",
  "project.instructions": "Instructions",
  "project.instructionsHint":
    "Shared context added to every chat in this project.",
  "project.instructionsPlaceholder":
    "e.g. You are helping with the Acme codebase. Prefer TypeScript…",
  "project.files": "Files",
  "project.addFiles": "Add files",
  "project.fileCount.one": "{n} file",
  "project.fileCount.other": "{n} files",
  "project.chars": "{used} / {budget} chars",
  "project.overBudget": "— over budget; excess is truncated when sending.",
  "project.noFiles": "No files yet. Text files are added as reference context.",
  "project.removeFile": "Remove {name}",
  "project.truncated": '"{name}" was truncated to {n} characters.',
  "project.readError": 'Couldn\'t read "{name}" as text.',

  // --- Thread titles created by the store -------------------------------------------------------------------------------------------------------------
  "thread.newChat": "New chat",
  "thread.image": "Image",
  "thread.untitled": "Untitled",
} as const;

/** All valid message keys — derived from the English catalog. */
export type MessageKey = keyof typeof en;

/** Bases of plural key families (`<base>.one`/`<base>.other`/…). */
export type PluralBase = {
  [K in MessageKey]: K extends `${infer B}.other` ? B : never;
}[MessageKey];

/** Interpolation parameters for `{name}`-style placeholders. */
export type MessageParams = Record<string, string | number>;

/**
 * A language pack: `{ name, code, strings }`, stored as `<bcp47>.json`.
 * Mirrors `LanguagePack` in `src-tauri/src/commands/languages.rs`.
 */
export interface LanguagePack {
  /** Native display name, e.g. "Deutsch". */
  name: string;
  /** BCP 47 code, e.g. "de" — the selection key and `Intl` locale. */
  code: string;
  /** Catalog-key → translated text. Missing keys fall back to English. */
  strings: Record<string, string>;
}

/** Replace `{name}` placeholders; unknown placeholders are left intact. */
export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * Translate a key against the active pack's strings, falling back to the
 * English catalog (never the raw key), then interpolate `params`.
 */
export function translate(
  strings: Record<string, string>,
  key: MessageKey,
  params?: MessageParams,
): string {
  const template = strings[key] ?? en[key];
  return interpolate(template, params);
}

/**
 * Translate a plural key family: picks `<base>.<category>` per
 * `Intl.PluralRules` for `locale` (e.g. Polish `few`/`many`), falling back to
 * `<base>.other`. `{n}` is available to the template along with `params`.
 */
export function translatePlural(
  strings: Record<string, string>,
  locale: string,
  base: PluralBase,
  n: number,
  params?: MessageParams,
): string {
  let category = "other";
  try {
    category = new Intl.PluralRules(locale).select(n);
  } catch {
    // Unknown locale string — keep "other".
  }
  // Stay within the pack's language before falling back to English: pack
  // category → pack .other → en category → en .other.
  const enDict = en as Record<string, string>;
  const template =
    strings[`${base}.${category}`] ??
    strings[`${base}.other`] ??
    enDict[`${base}.${category}`] ??
    enDict[`${base}.other`] ??
    "";
  return interpolate(template, { n, ...params });
}

/**
 * Validate an unknown value as a language pack. Returns the pack or `null`
 * (used for unit tests and as a guard when merging user packs; the Rust loader
 * performs the authoritative validation for files on disk).
 */
export function parseLanguagePack(value: unknown): LanguagePack | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string" || v.name.trim() === "") return null;
  if (typeof v.code !== "string" || !isValidCode(v.code)) return null;
  if (typeof v.strings !== "object" || v.strings === null) return null;
  const strings: Record<string, string> = {};
  for (const [k, s] of Object.entries(v.strings as Record<string, unknown>)) {
    if (typeof s !== "string") return null;
    strings[k] = s;
  }
  return { name: v.name, code: v.code, strings };
}

/** A plausible BCP 47 tag: subtags of letters/digits joined by `-`. */
export function isValidCode(code: string): boolean {
  return /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(code);
}

/**
 * Match a system locale (e.g. `navigator.language` = "de-AT") against the
 * available pack codes: exact (case-insensitive) match first, then primary
 * subtag ("de-AT" → "de"). Returns the matching code or `null`.
 */
export function matchLocale(
  systemLocale: string | undefined,
  available: string[],
): string | null {
  if (!systemLocale) return null;
  const sys = systemLocale.toLowerCase();
  const exact = available.find((c) => c.toLowerCase() === sys);
  if (exact) return exact;
  const primary = sys.split("-")[0];
  return available.find((c) => c.toLowerCase() === primary) ?? null;
}
