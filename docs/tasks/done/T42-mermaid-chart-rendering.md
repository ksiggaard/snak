# T42 — Mermaid chart rendering (bundled plugin, IDEAS 14)

- **Status:** done
- **Owner:** Claude (T42)
- **Priority:** P3
- **Layer:** Frontend + plugin manifest
- **Depends on:** T8, T12

(IDEAS 14.) A prebundled, enabled-by-default plugin that renders ` ```mermaid `
fenced blocks in assistant messages as diagrams (T8 Markdown pipeline). Ship the
renderer in-app (no remote code per the T12 declarative security model); plugin
enablement toggles it. Mind streaming (partial mermaid source must not crash) and
the model needs no special prompting — just render the syntax when it appears.

- 2026-06-13 (Claude): Done. **New T12 `renderer` category** (5th category):
  `PluginCategory`/`PLUGIN_CATEGORIES`/`CATEGORY_LABELS` + `RendererContribution`
  `{ language }` in `src/types/plugins.ts`; `CATEGORIES` in Rust
  (`plugins/mod.rs`) extended to 5; `HostRegistry.renderers` + the `renderer`
  arm in `buildRegistry`, plus the pure `hasRenderer(reg, language)` lookup
  (`src/lib/plugins.ts`, unit-tested). Per the declarative security model a
  manifest only *names* the language — the renderer component is built-in code
  keyed by it.
- 2026-06-13: **Bundled plugin** `src-tauri/src/plugins/builtin/mermaid.json`
  (`com.snak.mermaid`, category `renderer`, `contributes: { language: "mermaid" }`,
  `enabledByDefault: true`), registered in `builtin_manifests()`; the builtins
  test went 6→7 with a renderer assertion (`com.snak.mermaid` present).
- 2026-06-13: **Rendering** — `src/components/chat/Mermaid.tsx`: mermaid v11 is
  **dynamically imported** (stays out of the main bundle — code-split into its own
  lazy chunks, not "remote code"; it's a vendored dep), rendered with
  `securityLevel: "strict"` (mermaid's built-in DOMPurify strips scripts / escapes
  HTML labels). **Streaming-safe:** `mermaid.parse(code, { suppressErrors: true })`
  gates rendering, so the partial source that arrives token-by-token never throws —
  the raw source shows in a `<pre>` until it parses to a valid diagram, then the
  SVG swaps in. **Theme-aware:** re-renders with mermaid's `dark`/`default` theme
  to match the app's resolved light/dark (`resolveTheme` + `useTheme`).
- 2026-06-13: **Wiring** — `CodeBlock.tsx` reads the host registry
  (`usePlugins(selectRegistry)`) and, for a ` ```mermaid ` block, renders
  `<Mermaid>` only when `hasRenderer(registry, "mermaid")` (and the language is the
  one built-in renderer we ship). Disabling the plugin in Settings → Plugins falls
  through to the normal highlighted code block (raw source + copy) — the documented
  "disable to show source" behavior. No model prompting; no store/DB/message-shape
  changes.
- 2026-06-13: i18n: `plugins.category.renderer` in the catalog + all five packs;
  the Plugins settings card `CATEGORY_KEYS` gained the `renderer` entry so the new
  category heading renders/translates. Tests: `buildRegistry` renderer grouping +
  `hasRenderer` cases in `plugins.test.ts`. Verified: `npm run build` (mermaid
  confirmed code-split into separate chunks, not the main bundle), `npm run lint`,
  `npm test` (444 passed, +2), `cargo build`/`clippy`/`fmt --check`/`test` (64) —
  all green; touched files Prettier-clean.
