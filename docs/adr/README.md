# Architecture Decision Records

An ADR captures one architectural decision: the **context** that forced a choice, the
**decision**, and its **consequences**. They're the durable *why* behind the code — the
thing that's lost when rationale lives only in commit messages or someone's memory.

**Format: [MADR](https://adr.github.io/madr/).** All ADRs here follow the MADR template
(`0000-template.md`) — status/deciders/date, problem statement, decision drivers, considered
options, the outcome with positive/negative consequences, and pros and cons per option.
Future ADRs are written in this format too.

ADRs are immutable once accepted. Changed your mind? Write a new ADR that supersedes the old
one (set the old one's status to `superseded by ADR-NNNN`).

## Adding one

1. Copy [`0000-template.md`](./0000-template.md) to `NNNN-short-title.md` (next free number).
2. Fill in the MADR sections — problem statement, drivers, options, outcome, consequences,
   pros/cons. Cite the files the decision lives in.
3. Add a row to the log below.

## Log

| # | Title | Status |
| --- | --- | --- |
| [0001](./0001-api-keys-in-os-keychain.md) | API keys live in the OS keychain | accepted |
| [0002](./0002-provider-calls-in-rust-over-http.md) | Provider calls run in Rust over raw HTTP | accepted |
| [0003](./0003-frontend-owns-the-database.md) | The frontend owns the database | accepted |
| [0004](./0004-plugins-are-declarative.md) | Plugins are declarative (no code execution) | accepted |
| [0005](./0005-two-windows-one-bundle.md) | Two windows, one bundle | accepted |
| [0006](./0006-skills-via-progressive-disclosure.md) | Skills load via progressive disclosure | accepted |

These were back-filled from decisions already described in [`../../AGENTS.md`](../../AGENTS.md).
