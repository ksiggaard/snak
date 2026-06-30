---
description: Scaffold the next ADR from the MADR template and add it to the log
argument-hint: <short decision title>
---

Create a new Architecture Decision Record for snak.

The decision title is: **$ARGUMENTS**

Do this:

1. Find the next free ADR number: list `docs/adr/` and take one past the highest `NNNN`.
2. Copy `docs/adr/0000-template.md` to `docs/adr/NNNN-<kebab-title>.md` (derive the slug from the
   title).
3. Fill in the MADR sections. Set `Status: accepted` (unless I say otherwise), `Deciders: snak
   core team`, and today's date. Write a neutral Context, the Decision Drivers, the Considered
   Options (include the obvious rejected one), the Decision Outcome **citing the files/modules
   where the decision lives**, honest Positive **and** Negative Consequences, and per-option
   Pros/Cons. Match the tone of `docs/adr/0002`–`0011`.
4. Add a row to the log table in `docs/adr/README.md`.

If the decision isn't clear enough to write yet, ask me the open questions first. Follow the
`write-adr` skill for the detailed conventions.
