---
description: Run snak's full verification gate (build, lint, typecheck, Rust checks)
---

Run snak's verification gate and report the results. This is the "don't claim done without
running them" check from `docs/tasks/README.md`.

Run these, from the repo root unless noted:

1. `npm run build` — TypeScript typecheck + production Vite build.
2. `npm run lint` — ESLint.
3. `cargo clippy` — Rust lint (run from `src-tauri/`).
4. `cargo fmt --check` — Rust formatting (run from `src-tauri/`).
5. If anything touched i18n strings: `npx vitest run src/lib/locales.test.ts`.

Run them and summarize what passed and what failed. For each failure, show the relevant output
and the file:line, and propose a fix — but **do not** fix anything unless I ask. If everything
passes, say so plainly.
