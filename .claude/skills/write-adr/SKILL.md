---
name: write-adr
description: How to record an architectural decision for snak as an ADR in MADR format. Use when a hard-to-reverse or likely-to-be-second-guessed decision is made (a new subsystem, a security trade-off, a "why not the obvious thing" choice) and the rationale should be durable.
---

# Writing an ADR

An ADR captures **one** architectural decision: the context that forced a choice, the decision,
and its consequences. Write one when the *why* would otherwise be lost to commit messages or
memory. snak uses the [MADR](https://adr.github.io/madr/) format.

## Steps

1. **Pick the next number** — look at `docs/adr/`; the next free `NNNN` is one past the highest.
2. **Copy the template** — `docs/adr/0000-template.md` → `docs/adr/NNNN-short-title.md`. (The
   `/new-adr` command scaffolds this for you.)
3. **Fill every MADR section:**
   - Status (`accepted` for a decision already made), Deciders, Date (`YYYY-MM-DD`).
   - **Context and Problem Statement** — neutral facts; a reader in a year should understand the
     situation without already knowing the answer.
   - **Decision Drivers** — the forces (security, velocity, cost, …).
   - **Considered Options** — including the obvious one you rejected.
   - **Decision Outcome** — "Chosen option: **X**, because …", and **cite the files/modules the
     decision lives in** (this is what makes snak's ADRs useful).
   - **Consequences** — Positive *and* Negative. Be honest about the trade-off taken.
   - **Pros and Cons of the Options** — per option.
4. **Update the log** — add a row to the table in `docs/adr/README.md`.
5. **Cross-link** — reference related ADRs by number (e.g. `[ADR-0002](./0002-...md)`).

## Rules

- **ADRs are immutable once accepted.** Don't rewrite the decision later — if you change your
  mind, write a *new* ADR that supersedes it and set the old one's status to
  `superseded by [ADR-NNNN]`.
- Light **currency** edits (fixing a renamed file path or a dead link) are fine; changing the
  *decision* is not.

## Style to match

Read `docs/adr/0002`–`0011` for tone: concise, file-cited, honest about the negative
consequence. Keep each ADR to one screen or two.
