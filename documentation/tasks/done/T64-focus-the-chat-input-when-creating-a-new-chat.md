# T64 — Focus the chat input when creating a new chat

- **Status:** done
- **Owner:** Claude (T64)
- **Priority:** P3
- **Layer:** Frontend
- **Depends on:** —

(IDEAS 4.) When a new chat is created, automatically move keyboard focus to the composer
input so the user can start typing immediately.

**Acceptance criteria:**
- Triggering "New chat" (`startNewChat` in `src/store/threads.ts`) focuses the `Composer`
  textarea.
- Covers the sidebar new-chat action and any other new-chat entry points.
- Reuse the existing composer-focus seam added by the Cmd/Ctrl+L shortcut rather than adding
  a parallel mechanism.

**Notes:**
- 2026-06-17 (Claude, T64): Called `get().focusComposer()` at the end of all three
  new-chat actions — `startNewChat`, `startNewChatInProject`, and `startNewChatWithBot` —
  in `src/store/threads.ts`. Reuses the existing `composerFocus` nonce seam (introduced for
  Cmd/Ctrl+L) that the Composer already watches via a `useEffect`; no new focus path added.
  Covers the sidebar new-chat button and all other entry points. Verified: `npm run build` ✓,
  `npm run lint` ✓, `npm test` (609 pass, 2 pre-existing locale failures on the branch) ✓.
