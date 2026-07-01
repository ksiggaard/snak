# Documentation

Map of snak's docs for an agent (or human) working in this repo. **This folder is an index,
not a second copy of the facts** — the canonical architecture guide is
[`../AGENTS.md`](../AGENTS.md). When something here disagrees with `AGENTS.md`, `AGENTS.md`
wins; fix the index.

## Start here

New to the repo? Read [`../AGENTS.md`](../AGENTS.md) — it's the **always-loaded core**
(frontend/backend boundary, conventions, data layer, secrets) plus a router linking each
subsystem to its detail doc under [`architecture/`](./architecture/). Read the core top to
bottom, then follow the router into whichever subsystem you're touching.

## Index

| Where | What |
| --- | --- |
| [`../AGENTS.md`](../AGENTS.md) | **Canonical** core: layer boundary, conventions, data layer, secrets, + a router to the subsystem docs |
| [`architecture/`](./architecture/) | Per-subsystem detail (providers, plugins, MCP, skills, workspaces, …), one file each, linked from AGENTS.md's router and loaded on demand |
| [`../README.md`](../README.md) | Product overview, install, run, build |
| [`i18n.md`](./i18n.md), [`theming.md`](./theming.md) | Extension-authoring guides |
| [`superpowers/`](./superpowers/) | Dated `{specs,plans}` design docs — a **historical record** of how features were designed (each carries a banner; `AGENTS.md` is the current truth) |
| [`adr/`](./adr/) | Architecture Decision Records — the *why* behind the choices |
| [`tasks/`](./tasks/) | Work items, one file per task, foldered by status (`todo`/`in-progress`/`done`) |
| [`../.claude/`](../.claude/) | Claude Code **skills** (`skills/`: add-provider, add-migration, add-i18n-keys, write-adr, release) and **commands** (`commands/`: `/new-adr`, `/new-task`, `/preflight`) — reusable playbooks for working in this repo with an AI |

## Conventions

- **Decisions** that are hard to reverse or that future agents will second-guess go in
  [`adr/`](./adr/) (copy `0000-template.md`). Don't bury rationale in prose only.
- **Work** is tracked in [`tasks/`](./tasks/): a task is one file, its folder is its status.
- **Design specs / plans** live under [`superpowers/`](./superpowers/) (dated). They're a
  historical design record, not current truth — [`../AGENTS.md`](../AGENTS.md) is canonical.
