# Tasks

Work queue for agents implementing snak. Read [`../../AGENTS.md`](../../AGENTS.md) first for
architecture, conventions, and the frontend/backend boundary.

**One task = one file. Its folder = its status.** Move a file between folders to change its
status:

```
tasks/
  todo/          # not started
  in-progress/   # claimed and being worked
  done/          # acceptance criteria met and verified
```

`blocked/` is created when first needed (a task that can't proceed). There are none today.

Each file is named `T<NN>-<slug>.md` (zero-padded id so files sort). Use
[`_template.md`](./_template.md) for new tasks; pick the next free `T<NN>`.

## Working a task

1. **Claim it** — `git mv` the file from `todo/` to `in-progress/`, set `Status: in-progress`
   and `Owner:` to your agent id/name. One owner per task; don't pick up a task another agent owns.
2. **Work it** — follow the acceptance criteria. Respect the layer boundary in `AGENTS.md`
   (OS / DB / secrets → Rust; UI → React).
3. **Record progress** — add dated lines under `Notes:` as you go. If you hit a dependency or
   ambiguity you can't resolve, move the file to a `blocked/` folder and write why.
4. **Finish** — set `Status: done`, `git mv` to `done/`, when acceptance criteria are met *and*
   verified (`npm run build`, `npm run lint`, `cargo clippy` as applicable; see
   `superpowers:verification-before-completion`). Don't claim done without running them.

Keep edits surgical — only touch the task you own (plus adding a new task file).

## Metadata block

- **Status:** `todo` · `in-progress` · `blocked` · `done` (must match the folder)
- **Owner:** agent id/name, or `—` when unclaimed
- **Priority:** `P0` headline gap · `P1` usability · `P2` large feature · `P3` nice-to-have
- **Layer:** Rust / Frontend / DB (or a combination)
- **Depends on:** task ids (e.g. `T1, T12`), or `—`

## Already implemented (reference, do not redo)

Built in the current tree — listed so agents don't duplicate work:

- Tauri v2 + React 19 + TS + Vite scaffold; Tailwind v4 + shadcn/ui; light/dark/system theme.
- SQLite via `tauri-plugin-sql` with Rust-registered migrations; typed frontend helpers in `src/lib/db.ts`.
- API keys in the OS keychain (`keyring`); commands in `commands/keys.rs`.
- Providers over raw `reqwest` (Anthropic, OpenAI, Mistral, Gemini, Ollama) with the
  `Provider::stream` trait and SSE streaming; `chat_stream` command.
- Multi-thread chat with a Zustand store (`store/threads.ts`), lazy thread creation,
  last-active-thread restore, sidebar (rename/delete).
- Multimodal image + document input (`lib/image.ts`, `lib/documents.ts`, `attachments` table).
- Quick-input overlay window, global shortcut (`Alt+Space`, customizable), screenshot capture.
- Plugin/skill systems, slash commands, MCP, workspaces — see `AGENTS.md` for the full list.

## History

The 64 tasks in `done/` were migrated one-shot out of the old monolithic `TASKS.md`
(now a pointer here). Folders are the source of truth from here on.
