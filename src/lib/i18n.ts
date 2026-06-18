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
  "common.edit": "Edit",
  "common.default": "default",
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
  "common.settings": "Settings",
  "common.uninstall": "Uninstall",
  "common.builtIn": "built-in",
  "common.byAuthor": "by {author}",

  // --- Relative time (templates consumed by src/lib/time.ts) ----------------
  "time.justNow": "just now",
  "time.minutesAgo": "{n}m ago",
  "time.hoursAgo": "{n}h ago",
  "time.daysAgo": "{n}d ago",

  // --- Title bar -------------------------------------------------------------
  "titleBar.hideSidebar": "Hide sidebar",
  "titleBar.showSidebar": "Show sidebar",
  "titleBar.searchChats": "Search chats",
  "titleBar.settings": "Settings",
  "titleBar.usage": "Usage",
  "titleBar.offline": "Offline",
  "titleBar.offlineHint":
    "You're offline — only local models and tools are available. Click to check the connection.",
  "titleBar.offlineForcedHint":
    "Working offline (manual). Turn off “Work offline” in the menu to use cloud models again.",
  "titleBar.workOffline": "Work offline",
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
  "menu.focusInput": "Focus Chat Input",
  "menu.usage": "Usage",
  "menu.zoomIn": "Zoom In",
  "menu.zoomOut": "Zoom Out",
  "menu.resetZoom": "Reset Zoom",

  // --- Icon rail / manage menu ------------------------------------------------
  "rail.manage": "Manage",
  "manage.zoom": "Zoom",

  // --- Sidebar ----------------------------------------------------------------
  "sidebar.newChat": "New chat",
  "sidebar.newIncognitoChat": "New incognito chat",
  "sidebar.newIncognitoChatTitle":
    "New incognito chat — deleted when the app exits",
  "sidebar.newWorkspace": "New workspace",
  "sidebar.chats": "Chats",
  "sidebar.workspaces": "Workspaces",
  "sidebar.favorites": "Favorites",
  "sidebar.allChats": "All chats",
  "sidebar.archive": "Archive",
  "sidebar.archiveChat": "Close chat (move to Archive)",
  "sidebar.chatMenu": "Chat options",
  "sidebar.moveToWorkspace": "Move to workspace",
  "sidebar.clearArchive": "Clear archive",
  "sidebar.clearArchiveTitle": "Delete all {count} archived chats?",
  "sidebar.noConversations": "No conversations yet.",
  "sidebar.noWorkspaces": "No workspaces yet. Create one with “New workspace”.",
  "sidebar.noChatsInWorkspace": "No chats yet.",
  "sidebar.expandWorkspace": "Expand workspace",
  "sidebar.collapseWorkspace": "Collapse workspace",
  "sidebar.openWorkspace": "Open workspace",
  "sidebar.newChatInWorkspace": "New chat in workspace",
  "sidebar.editWorkspace": "Edit workspace",
  "sidebar.deleteWorkspace": "Delete workspace",
  "sidebar.deleteWorkspaceTitle": 'Delete workspace "{name}"?',
  "sidebar.deleteWorkspaceDescription":
    "Its chats are kept (moved out of the workspace).",
  "sidebar.bots": "Personas",
  "sidebar.newBot": "New persona",
  "sidebar.noBots": "No personas yet. Create one to start chatting.",
  "sidebar.newChatWithBot": "New chat with {name}",
  "sidebar.editBot": "Edit persona",
  "sidebar.deleteBot": "Delete persona",
  "sidebar.deleteBotTitle": 'Delete "{name}"?',
  "sidebar.deleteBotDescription":
    "Its chats are kept and become regular chats.",
  "sidebar.expandBot": "Expand persona",
  "sidebar.collapseBot": "Collapse persona",
  "sidebar.noChatsWithBot": "No chats yet",
  "sidebar.botBadge": "Persona: {name}",
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
  // T57 — rotating loading-message pool (cycles while pending before first token)
  "chat.loading.0": "Thinking…",
  "chat.loading.1": "On it…",
  "chat.loading.2": "Let me check…",
  "chat.loading.3": "Putting it together…",
  "chat.loading.4": "Almost there…",
  "chat.loading.5": "Working on it…",
  "chat.waitingApproval": "Waiting for your approval…",
  "chat.approvalTitle": "Allow this system access?",
  "chat.approvalExplain":
    "The read-only system tool wants to run the action below. Nothing runs until you allow it. Approved output is sent to your model provider.",
  "chat.approve": "Allow",
  "chat.approveAll": "Allow all this chat",
  "chat.deny": "Deny",
  "chat.approvalDestLocal":
    "Stays on this machine — runs locally via {provider}.",
  "chat.approvalDestCloud":
    "⚠ Will be sent to {provider} (cloud) — this data leaves your machine.",
  "chat.incognitoHint": "Incognito — this chat is deleted when the app exits.",
  "chat.incognitoHeader": "Incognito chat",
  "chat.incognitoExplainerTitle": "This is an incognito chat",
  "chat.incognitoExplainerIs":
    "It exists only for this session — the conversation is deleted when the app fully exits, and it is never restored as your last chat.",
  "chat.incognitoExplainerIsnt":
    "It does not protect your privacy from the model's provider: your messages are still sent to the provider you are chatting with.",
  "chat.compacted":
    "Conversation compacted — older messages above are summarized for the model",
  "chat.you": "you",
  "chat.ai": "ai",
  "chat.attachment": "attachment",
  "chat.webPage": "web page",
  "chat.toolRunning": "running…",
  "chat.toolWorking": "Working…",
  "chat.subagentsTitle": "Research subagents",
  "chat.subagent": "Subagent",
  "chat.subagentResearching": "researching…",
  "chat.subagentDone": "done",
  "chat.subagentFailed": "failed",
  "chat.reasoning": "Reasoning",
  "chat.toolArguments": "Arguments",
  "chat.apiTrace": "API trace",
  "chat.apiTraceRequest": "Request · round {round}",
  "chat.apiTraceResponse": "Response · round {round}",
  "chat.copy": "Copy",
  "chat.copied": "Copied",
  "chat.fullWidth": "Full width",
  "chat.exitFullWidth": "Fit to column",
  // --- Response variations (T54) -------------------------------------------
  "chat.newVariation": "New variation",
  "chat.prevVariation": "Previous variation",
  "chat.nextVariation": "Next variation",
  "chat.variationHint": "Only the shown variation is sent as context.",
  "chat.directionPlaceholder": "Optional direction — e.g. more professional",
  "chat.directionGenerate": "Generate",
  // --- Request sources (T56) -----------------------------------------------
  "chat.requestSources": "Request sources",
  "chat.copyCode": "Copy code",
  "chat.viewImage": "View image",
  "chat.viewDiagram": "View diagram",
  "chat.viewChart": "View chart",
  "chat.mapLabel": "Map",
  "chat.playVideo": "Play video",
  "chat.openOnYouTube": "Open on YouTube",
  "chat.inlineVideoUnavailable":
    "Inline playback needs gst-plugins-good — opening in your browser instead.",
  "chat.downloadImage": "Download",
  "chat.imageSaved": "Image saved.",
  "chat.imageSaveFailed": "Couldn't save the image.",
  "chat.imageSource": "Source",
  "chat.openInTerminal": "Open in terminal",
  "chat.openInTerminalTitle":
    "Open in terminal (staged, not run — review and press Enter)",
  "chat.botEmptyHint": "Say hi — {name} is ready.",
  // --- Empty new-chat suggestions (quick actions + persona starters) --------
  "chat.suggestionsTitle": "How can I help?",
  "chat.suggestionsHint":
    "Pick a quick action to get started, or just type below.",
  "chat.quickActionsLabel": "Quick actions",
  "chat.chatWithLabel": "Chat with a persona",
  "chat.chatWith": "Chat with {name}",

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
  "panel.workspace": "Workspace",
  "panel.noWorkspace": "No workspace",

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
  "composer.deepResearch": "Deep research",
  "composer.deepResearchTitle":
    "Deep research — let the model dispatch parallel subagents to investigate, then synthesize their findings",
  "composer.stop": "Stop",
  "composer.stopAria": "Stop generating",
  "composer.providerDisabled":
    "“{provider}” is disabled. Pick another provider above, or re-enable it in Settings → Plugins.",
  "composer.noProviders":
    "No providers are enabled. Enable a provider plugin in Settings → Plugins to start chatting.",
  "composer.noKey":
    "No API key set for {provider}. Add one in Settings to send messages.",
  "composer.ollamaDown":
    "Ollama isn't running. Start the daemon (ollama serve) to send messages.",
  "composer.ollamaCheckAgain": "Check again",
  "composer.offline":
    "You're offline. Pick a local model to keep chatting, or reconnect to use {provider}.",
  "composer.useLocalModel": "Use local model",
  "composer.checkConnection": "Check connection",
  "composer.imageError":
    "Couldn't process that image — it may be too large or an unsupported format.",
  "composer.terminalUsage": "Usage: /terminal <shell command>",
  "composer.runInTerminal": "Run this in a terminal?",
  "composer.terminalExplain":
    "The command below will be staged in your terminal for review — it is never auto-executed. You press Enter there to run it.",
  "composer.stageInTerminal": "Stage in terminal",
  "composer.pluginBadge": "plugin",
  "composer.mentionPaletteAria": "Mention a persona",
  "composer.terminalOpenError": "Couldn't open a terminal: {error}",
  "composer.pluginCommandNote":
    "The `{command}` command is provided by a plugin but has no built-in action in this host, so it can't run here.",
  "composer.terminalStagedNote":
    "Staged this command in your terminal — review it and press Enter there to run it (it was not auto-executed):",
  "composer.attachFile": "Attach file",
  "composer.removeDocument": "Remove document",
  "composer.extracting": "Extracting text…",
  "composer.documentReadError": "Couldn't read “{name}”: {error}",
  "composer.documentUnsupported":
    "“{name}” isn't a supported file type — attach an image, a text or code file, or a PDF/Office document.",
  "composer.documentLegacy":
    "“{name}” is a legacy Office format — save it as .docx/.pptx/.xlsx (or PDF) and try again.",
  "composer.documentTooLarge": "“{name}” is too large to attach (max {max}).",
  "composer.documentTruncated":
    "“{name}” was truncated to {n} characters to fit the context budget.",
  // Context-size readout (T53)
  "composer.contextEstimate": "~{tokens} tokens",
  "composer.contextEstimateHint":
    "Estimated context for your next message (≈4 chars/token). The exact token count is recorded after sending.",
  "composer.context": "{used} / {max} · {pct}%",

  // --- Document attachments (T39) -------------------------------------------------
  "document.chars": "{n} chars",

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

  // --- Artifacts ---------------------------------------------------------------
  "artifact.building": "Building artifact…",
  "artifact.writing": "writing…",
  "artifact.chars.one": "{n} char",
  "artifact.chars.other": "{n} chars",
  "artifact.previewTitle": "Artifact preview",
  "artifact.open": "Open",
  "artifact.code": "Code",
  "artifact.split": "Split",
  "artifact.addressBar": "Toggle address bar",
  "artifact.address": "Enter a URL or #route…",
  "artifact.back": "Back",
  "artifact.forward": "Forward",
  "artifact.run": "Run preview",
  "artifact.pause": "Pause preview",
  "artifact.paused": "Preview paused",
  "artifact.resize": "Drag to resize preview",
  "artifact.editPlaceholder": "Describe a change to this artifact…",
  "artifact.editStop": "Stop",
  "artifact.editing": "Updating artifact…",
  "artifact.editNoArtifact":
    "The model didn't return an updated artifact. Try rephrasing.",
  "artifact.editNoThread": "Couldn't resolve the model for this artifact.",
  "artifact.preview": "Preview",
  "artifact.refresh": "Refresh preview",
  "artifact.fullscreen": "Toggle fullscreen",
  "artifact.openInBrowser": "Open in browser",
  "artifact.export": "Export as .zip",
  "artifact.close": "Close",
  "artifact.viewerAria": "Artifact viewer",
  "artifact.loadingEditor": "Loading editor…",
  "artifact.fileCount.one": "{n} file",
  "artifact.fileCount.other": "{n} files",

  // --- Model chooser -----------------------------------------------------------
  "model.choose": "Choose model",
  "model.aria": "Model",
  "model.unavailable": "unavailable",
  "model.offline": "offline",

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
  "settings.nav.models": "Models",
  "settings.nav.memory": "Memory",
  "settings.nav.behavior": "Behavior",
  "settings.nav.appearance": "Appearance",
  "settings.nav.language": "Language",
  "settings.nav.mcp": "MCP Servers",
  "settings.nav.skills": "Skills",
  "settings.nav.plugins": "Plugins",
  "settings.nav.planner": "Planner",
  "settings.nav.bots": "Personas",
  "settings.nav.quickActions": "Quick actions",
  "settings.nav.advanced": "Advanced",

  // --- Settings: Advanced (T55) -------------------------------------------------------------
  "advanced.title": "Advanced",
  "advanced.description":
    "Tunables for power users. Most people can leave these alone.",
  "advanced.concurrencyLabel": "Deep research — subagents at once",
  "advanced.concurrencyHelp":
    "How many research subagents run in parallel. Lower if your provider rate-limits (HTTP 429) when several run together; higher finishes faster but hits the API harder.",
  "advanced.transparencyTitle": "Transparency",
  "advanced.captureReasoningLabel": "Show model reasoning",
  "advanced.captureReasoningHelp":
    "Capture the model's reasoning (extended thinking) and show it in a collapsible panel under each reply. Adds tokens and latency, and only some models/providers expose it — Anthropic and Gemini do; OpenAI/Mistral usually don't.",
  "advanced.captureTraceLabel": "Show API request/response trace",
  "advanced.captureTraceHelp":
    "Record the exact request sent to the provider each round (with large image/document data elided) plus a response summary, in a developer panel under each reply. For debugging and transparency.",

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
  "models.notesLabel": "Notes",
  "models.notesPlaceholder": "What this model is good at (e.g. great for coding)",

  // --- Settings: planner model -----------------------------------------------
  "planner.title": "Planner model",
  "planner.description":
    "Choose a model to orchestrate complex tasks. The planner analyzes your request, decides which model is best suited, and can break work into parallel steps. It acts as the recommended default when enabled.",
  "planner.modelLabel": "Planner model",
  "planner.defaultToggle": "Use planner for new chats by default",
  "planner.needsMoreModels":
    "A planner is most useful with at least two models configured. Add API keys for more providers to get the most out of it.",
  "planner.planning": "Planning…",
  "planner.stepRunning": "Running",
  "planner.stepDone": "Done",
  "planner.badge": "Planner",
  "planner.planTitle": "Plan",
  "planner.stepLabel": "Step {n}",
  "planner.synthesisLabel": "Synthesis",
  "planner.toggleOn": "Planner mode on",
  "planner.toggleOff": "Planner mode off",
  "planner.toggleHint":
    "Let the planner model decide how to handle your requests — routing to the best model or breaking into parallel steps.",

  // --- Settings: context windows (T53) -------------------------------------------
  "contextWindows.title": "Context windows",
  "contextWindows.description":
    "Set a max context window (in tokens) per model to show a usage bar in the chat. Models without an entry just show an estimate.",
  "contextWindows.empty": "No context windows configured yet.",
  "contextWindows.addLabel": "Add a model window",
  "contextWindows.modelPlaceholder": "Select a model",
  "contextWindows.maxTokens": "Max tokens",

  // --- Settings: Models (merged page) ----------------------------------------------------
  "models.disabledDescription":
    "Model settings are only available when the plugin is enabled.",
  "models.enablePlugin":
    "Enable the {pluginName} plugin to access these settings.",
  "models.pluginName": "Models",

  // --- Settings: local Ollama provider (T37) ---------------------------------------------------------
  "ollama.title": "Local (Ollama)",
  "ollama.description":
    "Chat with models running locally via the Ollama daemon (http://localhost:11434). No API key needed — installed models appear in the model picker automatically.",
  "ollama.statusChecking": "Checking…",
  "ollama.statusRunning": "Running — v{version}",
  "ollama.statusDown": "Not running",
  "ollama.setupIntro": "Ollama wasn't found. To get started:",
  "ollama.setupInstall": "Install Ollama (ollama.com/download)",
  "ollama.setupStart": "Start the daemon:",
  "ollama.setupPull": "Pull a first model, e.g.:",
  "ollama.installedModels": "Installed models",
  "ollama.noModels": "No models installed yet — pull one below.",
  "ollama.modelsHint": "These models are available in the chat model picker.",
  "ollama.pullLabel": "Pull a model",
  "ollama.pullPlaceholder": "llama3.2:1b",
  "ollama.pullStage": "Stage pull in terminal",
  "ollama.pullStagedHint":
    "Staged `ollama pull {name}` in your terminal — review it and press Enter there to run it, then Refresh here.",
  "ollama.pullInvalidName": "That doesn't look like a valid model name.",
  "ollama.start": "Start Ollama",
  "ollama.starting": "Starting…",
  "ollama.startHint": "Runs `ollama serve` for you.",
  "ollama.loadedModels": "Loaded now",
  "ollama.loadedHint":
    "Models currently held in memory. Unload one to free RAM/VRAM (it reloads on next use).",
  "ollama.inMemory": "{size} in memory",
  "ollama.unload": "Unload",
  "ollama.suggestedLabel": "Suggested models",

  // --- Settings: memory / system prompt --------------------------------------------------------------
  "memory.title": "System prompt & memory",
  "memory.description":
    "Added to the system context of every chat, ahead of any workspace instructions (precedence: global → workspace → thread).",
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

  // --- Settings: appearance — theme card ---------------------------------------------------------------
  "appearance.theme.title": "Theme",
  "appearance.theme.description": "Light, dark, or follow the system.",
  "appearance.theme.system": "System",
  "appearance.theme.light": "Light",
  "appearance.theme.dark": "Dark",

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

  // --- Settings: appearance — colors card ----------------------------------------------------------------------------
  "colors.title": "Colors",
  "colors.description":
    "Custom accent and background colors. Picks apply to the active mode (you are editing the {mode} palette); light and dark are stored separately. Text on top of a custom color is adjusted automatically for contrast. A custom background also re-tints the sidebar, title bar, cards, and input fields with matching darker or lighter tones.",
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
  "animations.title": "Animations",
  "animations.description":
    "Subtle motion throughout the app — views fade in, the sidebar slides, the thinking indicator pulses. Turn off for a fully static UI.",
  "animations.label": "UI animations",
  "density.title": "Density",
  "density.description":
    "How much breathing room the UI has — scaling padding and gaps throughout. Compact matches the original layout; Comfortable adds generous space.",
  "density.label": "Spacing density",

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
    "How messages are laid out in a conversation — from flat, bubble, or card layouts to dense, document, or terminal-like views.",
  "chatStyle.layout": "Layout",
  "chatStyle.default": "Default",
  "chatStyle.bubbles": "Bubbles",
  "chatStyle.compact": "Compact",
  "chatStyle.document": "Document",
  "chatStyle.cards": "Cards",
  "chatStyle.cozy": "Cozy",
  "chatStyle.terminal": "Terminal",
  "chatStyle.zebra": "Zebra",
  "chatStyle.preview": "Preview",
  "chatStyle.mockUser1": "How will my conversations look with this layout?",
  "chatStyle.mockAssistant":
    "Like this! Your messages are on one side, and replies like this one flow below them.",
  "chatStyle.mockUser2": "Nice, that works for me.",

  // --- Settings: appearance — chat list card -----------------------------------------------------------------------------------
  "chatList.title": "Chat list",
  "chatList.description":
    "What each conversation row in the sidebar shows: just the title, or extra details like the date, the model, a provider icon, or a preview of the last message.",
  "chatList.titleOption": "Title",
  "chatList.titleDate": "Title + date",
  "chatList.detailed": "Detailed",
  "chatList.preview": "Preview",
  "chatList.inline": "Inline date",
  "chatList.icon": "Icon",
  "chatList.compact": "Compact",
  "chatList.full": "Full",
  "chatList.mockTitle": "Weekend plans",
  "chatList.mockPreview": "Here's the packing list you asked for…",

  // --- Settings: appearance — chat width card --------------------------------------------------------------------------------
  "chatWidth.title": "Chat width",
  "chatWidth.description":
    "Cap how wide messages and the composer get on large windows, centering the conversation. Individual replies can still be expanded to full width.",
  "chatWidth.label": "Limit width",
  "chatWidth.maxWidth": "Max width",

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
  "mcp.envPlaceholder":
    "Environment variables, one KEY=value per line (e.g. START_URL=about:blank)",
  "mcp.envLabel": "Environment variables",
  "mcp.addServer": "Add server",
  "mcp.availableTools": "Available tools",
  "mcp.refreshHint": "Refresh to list tools from enabled servers.",
  // Web search backend (T52)
  "mcp.searchProvider": "Web search",
  "mcp.searchProviderHint":
    "Backend for the search_web tool — it finds pages so the model can fetch them. DuckDuckGo needs no key; Brave and Serper use an API key stored in your keychain.",
  "mcp.searchProviderDuckduckgo": "DuckDuckGo (keyless)",
  "mcp.searchProviderBrave": "Brave Search (API key)",
  "mcp.searchProviderSerper": "Serper (API key)",
  "mcp.searchApiKeyPlaceholder": "{provider} API key",
  "mcp.searchApiKeySaved": "Saved ✓",
  "mcp.sysLocalOnly":
    "System diagnostics is limited to local models (Ollama) — its data stays on this machine.",
  "mcp.sysCloudAllowed":
    "⚠ System diagnostics is allowed with cloud models — approved data is sent off-machine.",
  "mcp.sysAllowCloud": "Allow with cloud models…",
  "mcp.sysRestrictLocal": "Restrict to local",
  "mcp.sysCloudRiskTitle": "Allow system access with cloud models?",
  "mcp.sysCloudRiskBody":
    "This read-only tool reads your files, directories, owners/permissions, processes, network configuration, logs and other system details.\n\nWith a cloud model, everything you approve is transmitted to that third-party provider (Anthropic, OpenAI, Mistral or Google) and may be retained or logged on their servers. That can include secrets, tokens, private keys, and other sensitive data found in the files or output you approve.\n\nEach call still requires your explicit approval, but approval sends the data off your machine. Local models (Ollama) never have this risk. Only enable this if you understand and accept it.",
  "mcp.sysCloudRiskConfirm": "I understand — allow cloud access",

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
  "plugins.category.renderer": "Renderers",
  "plugins.noneInCategory": "No {category} installed.",
  "plugins.uninstallTitle": 'Uninstall "{name}"?',

  // --- Workspace view ----------------------------------------------------------------------------------------------------------------------------------
  "workspace.notFound": "Workspace not found.",
  "workspace.name": "Workspace name",
  "workspace.instructions": "Instructions",
  "workspace.instructionsHint":
    "Shared context added to every chat in this workspace.",
  "workspace.instructionsPlaceholder":
    "e.g. You are helping with the Acme codebase. Prefer TypeScript…",
  "workspace.files": "Files",
  "workspace.addFiles": "Add files",
  "workspace.fileCount.one": "{n} file",
  "workspace.fileCount.other": "{n} files",
  "workspace.chars": "{used} / {budget} chars",
  "workspace.overBudget": "— over budget; excess is truncated when sending.",
  "workspace.noFiles":
    "No files yet. Text files are added as reference context.",
  "workspace.removeFile": "Remove {name}",
  "workspace.truncated": '"{name}" was truncated to {n} characters.',
  "workspace.readError": 'Couldn\'t read "{name}" as text.',
  "workspace.addUrl": "Add URL",
  "workspace.urlPlaceholder": "https://example.com",
  "workspace.urlFetching": "Fetching…",
  "workspace.urlError": "Couldn't fetch URL: {error}",
  "workspace.urlInvalid": "Invalid URL: {error}",
  "workspace.sourceUrl": "Source: {url}",
  "workspace.youtubeNoCaptions":
    "This video has no closed captions available — the summary can't be generated.",
  "workspace.youtubeSummarizeError":
    "Couldn't summarize the video: {error}",
  "workspace.quickActions": "Quick actions",
  "workspace.quickActionsHint":
    "Override the global quick actions for chats in this workspace. Leave empty to use the global ones.",
  "workspace.quickActionsUsingGlobal":
    "This workspace uses the global quick actions. Add one below to override them here.",

  // --- Per-chat workspace file selector (T61) --------------------------------
  "workspace.fileSelector": "Workspace files",
  "workspace.fileSelectorHint":
    "Choose which workspace files are injected into this chat's context.",
  "workspace.fileSelectorAll": "All files included",
  "workspace.fileSelectorSome": "{n} / {total} files included",
  "workspace.fileSelectorNone": "No files included",

  // --- Workspace memory (T62) -----------------------------------------------
  "workspace.memory": "Workspace memory",
  "workspace.memoryHint":
    "Facts injected into every chat in this workspace, in addition to global memory.",
  "workspace.memoryEnabled": "Inject into chats",
  "workspace.memoryNoEntries":
    "No memory entries yet. Add facts the model should always know in this workspace.",
  "workspace.memoryAddPlaceholder": "e.g. This workspace uses the Acme v2 API",
  "workspace.memoryRemove": "Remove memory entry",

  // --- Workspace dashboard (T63) -------------------------------------------
  "workspace.dashboard": "Dashboard",
  "workspace.settingsPage": "Settings",
  "workspace.backToDashboard": "Back to dashboard",
  "workspace.openSettings": "Workspace settings",
  "workspace.stats": "Overview",
  "workspace.statsChats": "{n} chats",
  "workspace.statsFiles": "{n} files",
  "workspace.statsUrls": "{n} URLs",
  "workspace.statsMemories": "{n} memories",
  "workspace.recentMemories": "Recent memories",
  "workspace.urlsSection": "URLs",
  "workspace.filesSection": "Files",
  "workspace.chatsSection": "Chats",
  "workspace.noChats": "No chats yet.",
  "workspace.noUrls": "No URLs ingested yet.",
  "workspace.profileImage": "Profile image",
  "workspace.coverImage": "Cover image",
  "workspace.changeProfileImage": "Change profile image",
  "workspace.changeCoverImage": "Change cover image",
  "workspace.removeProfileImage": "Remove profile image",
  "workspace.removeCoverImage": "Remove cover image",
  "workspace.totalFileSize": "{size} chars total",

  // --- Quick actions (empty-screen starters) ---------------------------------
  "quickActions.title": "Quick actions",
  "quickActions.description":
    "One-tap starters shown on the empty new-chat screen. A prefill action drops its prompt into the composer; a send action fires it right away.",
  "quickActions.empty": "No quick actions. Add one, or reset to the defaults.",
  "quickActions.label": "Button label",
  "quickActions.labelPlaceholder": "e.g. Proof read text",
  "quickActions.prompt": "Prompt",
  "quickActions.promptPlaceholder":
    "e.g. Proofread the following text and fix any mistakes:",
  "quickActions.mode": "On click",
  "quickActions.modePrefill": "Prefill composer",
  "quickActions.modeSend": "Send immediately",
  "quickActions.add": "Add action",
  "quickActions.remove": "Remove action",
  "quickActions.reset": "Reset to defaults",
  "quickActions.moveUp": "Move up",
  "quickActions.moveDown": "Move down",

  // --- Bots / personas (T38, T40) ---------------------------------------------------------------------------------------------------------------------
  "bots.title": "Personas",
  "bots.description":
    "Personas with their own personality, avatar, and memory. Start a chat with one from the sidebar's Personas tab.",
  "bots.empty": "No personas yet.",
  "bots.notFound": "This persona no longer exists.",
  "bots.create": "Create persona",
  "bots.name": "Name",
  "bots.instructions": "Personality",
  "bots.instructionsHint":
    "Who this persona is — character, expertise, quirks — injected into every chat with it.",
  "bots.instructionsPlaceholder":
    "e.g. John is a very professional senior software engineer who always challenges your architecture.",
  "bots.tagline": "Subtitle",
  "bots.taglinePlaceholder": "e.g. The IT architect",
  "bots.modusOperandi": "Modus operandi",
  "bots.modusOperandiHint":
    "How {name} approaches problems and structures answers.",
  "bots.modusOperandiPlaceholder":
    "e.g. Asks clarifying questions first, then answers step by step.",
  "bots.toneOfVoice": "Tone of voice",
  "bots.toneOfVoiceHint": "How {name} sounds — register, warmth, directness.",
  "bots.toneOfVoicePlaceholder": "e.g. Warm but direct, with dry humor.",
  "bots.starters": "Conversation starters",
  "bots.startersHint":
    "Opening lines shown as one-tap chips on {name}'s empty chat — a great way to surface what this persona is good at. One per line.",
  "bots.startersPlaceholder":
    "e.g. Review my system architecture\nExplain a design pattern with an example\nWhat would you change about this API?",
  "bots.avatar": "Avatar",
  "bots.uploadAvatar": "Upload image",
  "bots.removeAvatar": "Remove",
  "bots.avatarError": "Couldn't use that image.",
  "bots.pasteAvatar": "Paste",
  "bots.pasteAvatarHint":
    "Use an image from the clipboard — Ctrl+V over the editor works too",
  "bots.avatarPasteError": "No image found in the clipboard.",
  "bots.defaultModel": "Default model",
  "bots.defaultModelHint": "New chats with this persona start on this model.",
  "bots.useAppDefault": "Use app default",
  "bots.appDefault": "App default",
  "bots.memory": "Memory",
  "bots.memoryHint":
    "Notes this persona keeps across conversations — injected into its chats. You can review, edit, or remove anything here.",
  "bots.memoryAdd": "Add memory",
  "bots.memoryPlaceholder": "e.g. The user prefers concise answers.",
  "bots.memoryRemove": "Remove memory",
  "bots.memoryAuto": "added by {name}",
  "bots.autoMemory": "Let {name} manage their own memory",
  "bots.autoMemoryHint":
    "After each exchange, {name} may save, update, or remove memories about you. You can always review and edit them here.",
  "bots.moodEnabled": "Mood",
  "bots.moodEnabledHint":
    "{name} carries a mood between conversations, shaped by how your chats go.",
  "bots.currentMood": "Current mood",
  "bots.noMood": "Neutral",
  "bots.clearMood": "Reset mood",
  "bots.newChat": "New chat with {name}",

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
