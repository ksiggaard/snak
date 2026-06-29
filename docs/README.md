# Documentation

Map of snak's docs for an agent (or human) working in this repo. **This folder is an index,
not a second copy of the facts** — the canonical architecture guide is
[`../AGENTS.md`](../AGENTS.md). When something here disagrees with `AGENTS.md`, `AGENTS.md`
wins; fix the index.

## Start here

New to the repo? Read [`../AGENTS.md`](../AGENTS.md) top to bottom — it covers the
frontend/backend boundary, conventions, and every subsystem (data layer, providers, plugins,
skills, slash commands, MCP, workspaces). Everything below points around it.

## Index

| Where | What |
| --- | --- |
| [`../AGENTS.md`](../AGENTS.md) | **Canonical** architecture, conventions, layer boundary, per-subsystem detail |
| [`../README.md`](../README.md) | Product overview, install, run, build |
| [`i18n.md`](./i18n.md), [`theming.md`](./theming.md) | Extension-authoring guides |
| [`superpowers/`](./superpowers/) | Dated `{specs,plans}` design docs for in-flight features |
| [`adr/`](./adr/) | Architecture Decision Records — the *why* behind the choices |
| [`tasks/`](./tasks/) | Work items, one file per task, foldered by status (`todo`/`in-progress`/`done`) |

## Conventions

- **Decisions** that are hard to reverse or that future agents will second-guess go in
  [`adr/`](./adr/) (copy `0000-template.md`). Don't bury rationale in prose only.
- **Work** is tracked in [`tasks/`](./tasks/): a task is one file, its folder is its status.
- **Design specs / plans** for in-flight features live under [`superpowers/`](./superpowers/) (dated).
