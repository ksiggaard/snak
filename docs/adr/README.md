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
| [0007](./0007-runtime-plugins-are-trusted-js.md) | Runtime plugins are executable, trusted JS | accepted |
| [0008](./0008-mcp-stateful-per-thread-sessions.md) | MCP servers run as stateful per-thread sessions | accepted |
| [0009](./0009-deep-research-via-subagents.md) | Deep research runs as dispatched parallel subagents | accepted |
| [0010](./0010-cloud-providers-are-user-added-custom-providers.md) | Cloud providers are user-added custom providers, not plugins | accepted |
| [0011](./0011-document-attachments-as-extracted-text.md) | Document attachments inject extracted text everywhere | accepted |

ADRs 0001–0006 were back-filled from decisions already described in
[`../../AGENTS.md`](../../AGENTS.md); 0007–0011 record subsystems added since (runtime plugins,
MCP, deep research, custom providers, document attachments). ADR-0010 supersedes the T18
"providers as plugins" design (`../superpowers/specs/2026-06-09-providers-as-plugins-design.md`).
