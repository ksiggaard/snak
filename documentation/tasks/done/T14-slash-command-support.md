# T14 — Slash command support

- **Status:** done
- **Owner:** Wave5-T14
- **Priority:** P3
- **Layer:** Frontend (parsing/UX) + Rust (execution) + plugins
- **Depends on:** T12

(README idea 7.) Slash commands typed in the composer, installable via plugins. Example:
`/terminal cat /path/to/file` runs a terminal command (via a plugin) and feeds the output
into the chat.

**Acceptance criteria:**
- Composer detects `/command args`, with discovery/autocomplete of available commands.
- Commands are contributed by plugins (T12); a command can transform input, inject context,
  or run a backend action and feed output into the thread.
- The `/terminal …` example works end-to-end as a reference plugin (executes via Rust,
  output rendered in chat). Command execution has an explicit safety/confirmation model.

**Notes:**
- Running arbitrary terminal commands is dangerous — gate behind confirmation/allowlist.
- 2026-06-09 (Wave5-T14): Done. Pure parsing/resolution in **`src/lib/slashCommands.ts`**
  (`parseSlashInput`/`availableCommands`/`matchCommands`/`resolveCommand` + `BUILTIN_COMMANDS`),
  unit-tested in `slashCommands.test.ts` (22 tests: parse edge cases, plugin folding/dedup,
  match filtering, resolution). The composer (`Composer.tsx`, owned deep-edit) detects a
  leading `/`, shows an **autocomplete palette** (Up/Down/Tab/Enter/Esc) of built-in +
  enabled-plugin commands, and routes a resolved command on send while leaving normal
  (non-slash) sending unchanged (a leading space, `//literal`, or an unresolved `/foo` all
  send as normal text). T9's canvas/expand button integrated additively.
  - **Plugin integration:** plugin commands come from the **T12 host registry**
    (`selectRegistry(usePlugins).slashCommands` → `{ command, description }`) — never plugin
    internals. Per T12's declarative security model, contributions advertise a command but
    ship no executable code, so an unhandled contribution is discoverable but posts an
    explanatory chat note instead of running. Added a built-in `slash-command` plugin
    `src-tauri/src/plugins/builtin/terminal.json` (registered in `plugins/mod.rs`
    `builtin_manifests()`; the builtins-count test updated 4→5 with a category assertion).
  - **`/terminal <cmd>` reference (end-to-end):** built-in `kind: "terminal"`. Running it
    NEVER auto-executes — it opens an in-composer **confirmation gate** showing the exact
    command; only on the user clicking "Stage in terminal" does it call **T17's
    `openInTerminal`** (`src/lib/terminal.ts` → Rust `open_in_terminal`, which *stages* the
    command pre-typed in an OS terminal for the user to review and Enter). A fenced
    confirmation is then fed into the thread. **Safety gate:** model/user shell text is never
    run silently — explicit confirm in-app + a second explicit Enter in the terminal.
  - **`store/threads.ts` touch (additive only):** one new action `postNote(content)`
    (interface decl + impl) that persists a synthetic `assistant` message into the current
    thread (lazy draft-thread creation mirroring `send`), with no provider/stream call — the
    channel slash output uses to feed the thread. **`send()`'s internals are untouched.**
  - Verified: `npm run build` ✓, `npm run lint` ✓, `npm test` (143 pass, +22) ✓;
    `cargo build`/`clippy`/`fmt --check` ✓, `cargo test` (41 pass) ✓.
