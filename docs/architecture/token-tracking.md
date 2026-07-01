# Token & context tracking

> Part of snak's architecture guide. Core & layer boundary: [`AGENTS.md`](../../AGENTS.md).

- **Recorded usage:** every API response writes a `usage` row (provider, model, input/output/cache-creation/cache-read tokens; migration `003`). Display helpers in `src/lib/usage.ts` (token formatting + a GitHub-style 365-day heatmap).
- **Live context-size estimate:** `src/lib/contextSize.ts` shows a rough, provider-agnostic estimate in the composer — `ceil(chars / 4)` + ~1000 tokens/image over the (post-compaction) thread history + draft — labelled an *estimate* (exact counts are only known after a response).
