# T53 — Context-size display at the bottom of the chat

- **Status:** done
- **Owner:** Claude (T53)
- **Priority:** P2
- **Layer:** Frontend + settings (per-model window map)
- **Depends on:** T16 (usage), T28 (compaction), T39 (documents)

(IDEA 24.) Show how much context the next message will consume. Live **estimate** by default;
**optionally** register a per-model max context window to also show `used / max (%)` with a bar.

**Acceptance criteria:**
- A readout at the bottom of the chat showing the estimated tokens of the next request, updating
  live as the thread/draft changes.
- A settings option to register a max context window per model; when set, the readout adds a
  `used / max (%)` usage bar; models without an entry show just the estimate.

**Notes:**
- 2026-06-13 (Claude): Pure estimator `src/lib/contextSize.ts` (`estimateTokens` ≈ `len/4`,
  `estimateMessagesTokens` over the post-compaction history via `compactHistory` so document text
  rides in content + a flat per-image allowance, `estimateContextTokens` adds the unsent draft) —
  unit-tested. Display: `src/components/chat/ContextMeter.tsx` mounted at the bottom of `Composer`
  (between staged attachments and the button row); always shows `~N tokens` (labelled estimate),
  and `used / max (%)` + a fill bar (warns amber ≥90%, destructive ≥100%) when the active model has
  a configured window. Per-model windows are a JSON `{ model: maxTokens }` in the `settings` table
  (`MODEL_CONTEXT_WINDOWS_KEY`, helpers in `db.ts`), a `useContextWindows` store loaded at startup
  in `App.tsx`, and a `settings/ContextWindows` card (added to `SettingsView`) that picks from the
  configured models. `ChatView` passes the effective `model` to `Composer`. New `composer.context*`
  + `contextWindows.*` + `settings.nav.contextWindows` i18n keys in the catalog + all five packs.
  Estimates are client-side (no tokenizer); exact usage is still captured post-send by T16.
  Verified: `npm run build`/`lint`/`test` (461, incl. new estimator tests).
