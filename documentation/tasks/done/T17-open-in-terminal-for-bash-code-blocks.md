# T17 — "Open in terminal" for bash code blocks

- **Status:** done (Wave2-T17, 2026-06-09)
- **Owner:** Wave2-T17
- **Priority:** P2
- **Layer:** Frontend (detect) + Rust (launch terminal)
- **Depends on:** T8

(README idea 10.) When an assistant response contains a `bash`/`sh` fenced code block, show
a button to open a terminal pre-loaded with that command.

**Acceptance criteria:**
- `bash`/`sh` code blocks (rendered via T8) get an "Open in terminal" action.
- A Rust command launches the KDE terminal (e.g. Konsole) with the command staged but
  **not auto-executed** (user reviews/runs it), mirroring the desktop-only, platform-gated
  pattern of `take_screenshot` in `commands/quick.rs`.
- Safe handling of multi-line commands and shell-special characters.

**Notes:**
- Never auto-run model-generated commands — stage only, require explicit user execution.
