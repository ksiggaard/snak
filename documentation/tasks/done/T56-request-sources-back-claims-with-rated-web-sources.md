# T56 — Request sources: back claims with rated web sources

- **Status:** done
- **Owner:** Claude (T56)
- **Priority:** P2
- **Layer:** Frontend (button + store action + rendering); reuses the existing Rust web tools
- **Depends on:** T13 (MCP + built-in web server, tool-call loop), T52 (search_web), the
  variations feature (`regenerate`)

(IDEAS 1.) Add a **Request sources** button beside the variations controls of an assistant
reply. Clicking it re-asks the model to back up the claims in that reply with web sources:
it adds per-claim **footnotes**, rates the **credibility of each source URL**, and includes
supporting **quotes**. When a claim has no findable source, the model says it can't confirm
that claim rather than inventing one. The web infrastructure already exists (`search_web` +
`fetch_url` tools, `ToolSource[]` tracking) — this is a new button + store action +
rendering, not new network code.

**Acceptance criteria:**
- A **Request sources** button rendered next to `VariationControls` in the assistant footer
  (the `trailing` slot of `AssistantMeta`, `src/components/chat/MessageList.tsx`).
- Clicking runs a new store action (mirroring `regenerate()` / `applyRegenSteer()` in
  `src/store/threads.ts` + `src/lib/variations.ts`) that re-prompts the model to verify its
  prior reply against the web using the existing `search_web` / `fetch_url` tools.
- The result renders footnotes mapping claims → sources; each web source shows a credibility
  rating and a supporting quote; reuse the existing `ToolSource[]` / tool-activity surface.
- Claims with no source are explicitly flagged as unconfirmable.
- The no-tools invariant and per-provider behavior are unchanged.

**Notes:**
- 2026-06-17 (Claude, T56): Implemented. Pure steer logic in `src/lib/variations.ts`
  (`REQUEST_SOURCES_STEER` constant + `applySourcesSteer()` — unlike `applyRegenSteer`, this
  always appends a fresh user turn since the history already ends on the assistant reply being
  sourced). Store action `requestSources(messageId)` in `src/store/threads.ts` assembles
  history including the target reply, applies the steer, runs the normal `chatStream` path
  (so the existing tool loop + `ToolSource` capture + tool-activity panel all work unchanged),
  and persists the result as a new standalone assistant message (`variant_group: null`) appended
  after the original — the original is kept. `RequestSourcesButton` in `MessageList.tsx`
  (BookOpenText icon, same tiny-button styling as the other meta-row controls) renders for all
  persisted assistant messages and is wired into the `trailing` slot of `AssistantMeta` alongside
  `VariationControls`. GFM footnotes already rendered by `remark-gfm` v4; added minimal
  `section[data-footnotes]` CSS in `index.css` for visual separation. i18n key
  `chat.requestSources` added to the TS catalog + all 5 locale packs. 5 new pure unit tests in
  `src/lib/variations.test.ts`. Full gate: build ✓, lint ✓, 623 tests ✓
  (locales.test.ts passes, 5 new T56 variations tests pass).
