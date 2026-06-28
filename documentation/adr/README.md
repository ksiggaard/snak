# Architecture Decision Records

An ADR captures one architectural decision: the **context** that forced a choice, the
**decision**, and its **consequences**. They're the durable *why* behind the code — the
thing that's lost when rationale lives only in commit messages or someone's memory.

ADRs are immutable once Accepted. Changed your mind? Write a new ADR that supersedes the old
one (set the old one's status to `Superseded by NNNN`).

## Adding one

1. Copy [`0000-template.md`](./0000-template.md) to `NNNN-short-title.md` (next free number).
2. Fill in Context / Decision / Consequences. Cite the files the decision lives in.
3. Add a row to the log below.

## Log

| # | Title | Status |
| --- | --- | --- |
| [0001](./0001-api-keys-in-os-keychain.md) | API keys live in the OS keychain | Accepted |
| [0002](./0002-provider-calls-in-rust-over-http.md) | Provider calls run in Rust over raw HTTP | Accepted |
| [0003](./0003-frontend-owns-the-database.md) | The frontend owns the database | Accepted |
| [0004](./0004-plugins-are-declarative.md) | Plugins are declarative (no code execution) | Accepted |
| [0005](./0005-two-windows-one-bundle.md) | Two windows, one bundle | Accepted |
| [0006](./0006-skills-via-progressive-disclosure.md) | Skills load via progressive disclosure | Accepted |

These were back-filled from decisions already described in [`../../AGENTS.md`](../../AGENTS.md).
