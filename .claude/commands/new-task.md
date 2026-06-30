---
description: Scaffold a new task file in docs/tasks/todo/ from the template
argument-hint: <task title>
---

Create a new task for snak.

The task title is: **$ARGUMENTS**

Do this:

1. Read `docs/tasks/README.md` for the workflow and metadata conventions.
2. Find the next free task id `T<NN>` (zero-padded, one past the highest across `todo/`,
   `in-progress/`, and `done/`).
3. Copy `docs/tasks/_template.md` to `docs/tasks/todo/T<NN>-<kebab-title>.md`.
4. Fill in the metadata block: `Status: todo`, `Owner: —`, a sensible `Priority`
   (`P0` headline gap · `P1` usability · `P2` large feature · `P3` nice-to-have), the `Layer`
   (Rust / Frontend / DB), and `Depends on:` if any.
5. Draft a clear goal and acceptance criteria from the title. Ask me to clarify scope if the
   title is ambiguous.

Don't start implementing — this just files the task.
