# T36 — Incognito mode: explainer + unmistakable visual identity

- **Status:** done
- **Owner:** Claude (T36–T39 wave)
- **Priority:** P2
- **Layer:** Frontend
- **Depends on:** — (builds on T29, done)

(IDEAS 9.) Incognito (T29) is currently marked only by a small Ghost icon + muted italic
title on the thread row (`src/components/sidebar/ThreadRow.tsx`) and a one-line hint above
the composer (`src/components/chat/ChatView.tsx`). That's too subtle for a mode with
privacy implications — make it impossible to miss, and explain honestly what it does and
does not protect.

**Acceptance criteria:**
- **Pre-first-message explainer:** when an incognito draft/thread has no messages yet, the
  empty chat area shows an explainer card stating what incognito *is* (the chat is purged
  when the app exits; it never becomes `last_thread_id`) and what it *isn't* — **your
  privacy from the provider is NOT protected: messages are still sent to the hosted
  provider** (Anthropic/OpenAI/etc.). Wording must generalize across providers (don't
  hardcode "Claude").
- **Chat-area distinction while active:** a persistent, clearly visible treatment of the
  whole chat surface (e.g. tinted/dashed border or distinct background + a labeled Ghost
  header), not just the current one-line hint. Theme tokens only — works in light/dark and
  with installed themes (T11).
- **Sidebar distinction:** the thread row reads as incognito at a glance beyond the small
  icon (e.g. tinted row background / left border + the Ghost badge). Must not break
  selection highlight, rename, favorite, delete, or the T35 row styles.
- All new strings go through the i18n catalog (`src/lib/i18n.ts`, T32) with the six
  bundled translations (`src/locales/*.json`) updated.

**Notes:**
- Files: `src/components/chat/ChatView.tsx`, `src/components/sidebar/ThreadRow.tsx`,
  `src/index.css` (if a reusable incognito tint helps), `src/locales/*.json`.
- The quick overlay has no incognito path (T29 left it out) — out of scope here too.
- 2026-06-12 (Claude): Implemented in `ChatView.tsx` + `ThreadRow.tsx`, tokens only.
  **Explainer:** an `IncognitoExplainer` card replaces the message list while an
  incognito draft/thread has no messages — Ghost icon, what it IS (session-only,
  purged on full exit, never restored as last chat) and what it ISN'T (messages
  still go to the model's provider; wording provider-generic). **Chat surface:**
  the chat column gets a dashed border + `bg-muted/20` tint and a labeled header
  strip (Ghost + "Incognito chat" + the old hint text on ≥sm); the old one-line
  hint under the list was folded into the strip. **Sidebar:** ephemeral rows get
  a dashed `border-l-2` edge + `bg-muted/40` tint (suppressed when active so the
  selection highlight wins), composing with all T35 row styles. Four new i18n
  keys (`chat.incognitoHeader`, `chat.incognitoExplainer{Title,Is,Isnt}`)
  translated in all five packs. Verified: npm build/lint/test (308) green.
