# T10 — Settings: system-message append + user memory

- **Status:** done
- **Owner:** Wave3-T10
- **Priority:** P1
- **Layer:** Frontend + DB (Rust migration)
- **Depends on:** —

(README idea 3.) Extend the existing settings panel (`src/App.tsx`, `src/components/
settings/`) with: (a) a custom string appended to the system prompt, and (b) persistent
"memory about the user" injected into context.

**Acceptance criteria:**
- A settings field for a custom system-prompt addendum, persisted (global in the `settings`
  table, or per-thread — decide and document) and actually prepended/merged into the
  provider `system` field on each request (see how Anthropic/Gemini handle `system` in
  `src-tauri/src/providers/`).
- A "user memory" store (likely a new table via a numbered migration in
  `src-tauri/migrations/`) editable in settings and injected into the system context.
- Existing chats keep working when these are empty.

**Notes:**
- Anthropic/Gemini take `system`/`systemInstruction` specially — consult the `claude-api`
  skill before changing request shapes.
- 2026-06-09 (Wave3-T10): Implemented at the **message-assembly layer** in
  `store/threads.ts` `send()` — no `src-tauri/src/providers/` changes (T18 owns that), riding
  the existing `role:"system"` handling each provider already has.
  - **Both inputs are global** (apply to every thread/provider) — simplest model, documented
    in `src/lib/systemContext.ts`. The **system-prompt addendum** is a single global string in
    the `settings` table (`system_prompt_addendum`); **user memory** is a row-per-entry table
    (`user_memory`, migration **005**, version 5).
  - **Composition (`src/lib/systemContext.ts` — `buildGlobalSystemText`, unit-tested):** the
    addendum + a bulleted "Memory about the user:" block are combined into one leading
    `role:"system"` message. Empty inputs produce `""` and are skipped, so existing chats are
    unaffected when nothing is configured.
  - **Precedence global → project → thread:** in `send()` the project system message (T20's
    `buildProjectSystemText`) is `unshift`ed first and the global message second, so the array
    ends up `[global, project, ...history]`. Providers concatenate consecutive `system` messages
    in array order (Anthropic/Gemini join with `\n\n`; OpenAI/Mistral pass through), realizing
    the precedence with no Rust changes. "Thread" = the conversation history (no separate
    per-thread prompt exists).
  - **UI:** `src/components/settings/Memory.tsx` ("System prompt & memory" card), mounted in
    `src/App.tsx` between ApiKeys and Shortcut. DB helpers added to `src/lib/db.ts`
    (`listUserMemory`/`addUserMemory`/`updateUserMemory`/`deleteUserMemory`,
    `SYSTEM_PROMPT_ADDENDUM_KEY`); `UserMemory` type in `src/types/db.ts`.
