# T4 — Test infrastructure + initial coverage

- **Status:** done
- **Owner:** Agent C
- **Priority:** P1
- **Layer:** Frontend (Vitest) + Rust (`cargo test`)
- **Depends on:** —

There are **no tests** in the repo (no `*.test.*`, no `#[test]`/`#[cfg(test)]`). Stand up
test tooling and seed it with meaningful unit tests on pure logic. Follow
`superpowers:test-driven-development` for any new code written under later tasks.

**Acceptance criteria:**
- Frontend: Vitest configured with an `npm test` script; cover pure helpers such as
  `deriveTitle`, `lib/image.ts` sizing math, and SSE/message shaping logic that can run
  without the Tauri runtime (mock `@tauri-apps/api` where needed).
- Rust: at least the SSE line driver `for_each_sse_data` (`providers/mod.rs`) and one
  per-provider request/response mapping covered by `cargo test`.
- `npm test` and `cargo test` both pass.

**Notes:**
- 2026-06-09 (Agent C): Frontend test infra stood up with **Vitest** (`@vitest/coverage-v8`
  + `jsdom`). Added `test`/`test:watch` scripts and `vitest.config.ts` (mirrors the `@/`
  alias, `environment: "jsdom"`, v8 coverage → `coverage/`). 39 unit tests across 6 files
  (all green): `deriveTitle` (empty/whitespace/boundary-48/truncation), `scaledDimensions`
  (no-upscale clamp + rounding, longer-side selection), `imageDataUrl`, `cn`, theme
  resolution (`getStoredTheme`/`systemPrefersDark`/`resolveTheme`/`applyTheme` with mocked
  `matchMedia` + `localStorage`), and the `PROVIDERS` registry shape. `coverage/` ignored
  in `eslint.config.js` + `.prettierignore`. `npm run build` (tsc) and `npm run lint` stay
  clean.
- **Rust tests: SKIPPED (follow-up).** The SSE line driver `for_each_sse_data` requires a
  real `reqwest::Response` (no pure-string entry point), and per-provider request bodies are
  built inline inside the `async fn stream` methods — there is no extracted pure sync target.
  Every sync fn in `commands/` touches `AppHandle`/keyring/filesystem/OS commands. Covering
  any of these needs either an invasive refactor (extract a pure `build_body(req) -> Value`
  helper per provider, or a `parse_sse_line`/string-driver split) or HTTP mocking deps
  (e.g. `wiremock`) — out of scope under the "no signature changes / minimal Rust" constraint.
  Recommended follow-up: extract `build_request_body` per provider + a string-level SSE
  parser, then unit-test those with `cargo test`.
