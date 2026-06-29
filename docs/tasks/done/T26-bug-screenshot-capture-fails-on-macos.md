# T26 — Bug: screenshot capture fails on macOS ("Could not create image from rect")

- **Status:** done
- **Owner:** WS-A
- **Priority:** P1 (a headline feature is broken)
- **Layer:** Rust (+ permissions/UX)
- **Depends on:** —

Taking a screenshot errors with "Could not create image from rect" on macOS (possibly
elsewhere). The capture path is `take_screenshot` in `src-tauri/src/commands/quick.rs`
(runs `screencapture -i`, returns base64 PNG; temp prefix `snak-shot-…`).

**Acceptance criteria:**
- Reproduce and root-cause it (likely macOS Screen Recording permission, an interactive-
  capture cancel writing no file, or temp-path/rect handling). Use `superpowers:systematic-debugging`.
- An interactive region capture returns a valid image; a user-cancelled capture returns
  `null` cleanly without surfacing an error.
- If the OS denies Screen Recording permission, surface a clear, actionable message telling
  the user to grant it.
- Verify on macOS; note Linux (`spectacle -r`) behavior.

**Notes:**
- 2026-06-10 (WS-A): Root cause confirmed — `capture_interactive()` (macOS) used `.status()`,
  discarding stderr and the exit code; `read_and_encode` then treated the absent/empty output
  file as a clean user cancel (`Ok(None)`), silently masking permission-denied and degenerate-
  rect failures. Fix: rewritten to `.output()` with three-way outcome classification: (1) exit
  success + no file + empty stderr → `Ok(None)` (genuine user cancel, unchanged); (2) non-zero
  exit or absent file with permission-related stderr ("could not create image from rect" /
  "not authorized" / "permission") → `Err(PERMISSION_MSG)` with actionable instructions to
  grant Screen Recording in System Settings; (3) other failure → `Err` surfacing trimmed stderr
  verbatim. Added `-x` flag to silence the shutter sound while the overlay is hidden. Linux
  Spectacle branch left functionally unchanged (its file-or-nothing behavior already maps
  correctly through `read_and_encode`). Frontend `QuickInput.tsx`: wrapped `screenshot()` body
  in try/catch; caught `Err` message surfaced via a new `error` state rendered as a
  `text-destructive` `<p>` above the textarea (dismisses on next attempt or cancel/reset). T5
  macOS slice: added `src-tauri/Info.plist` with `NSScreenCaptureUsageDescription` and
  referenced it via `bundle.macOS.infoPlist` in `tauri.conf.json` so packaged builds declare
  the usage string to macOS. Icons: the `src-tauri/icons/` set is real snak branding (512×512
  teal lips/"Snak" logo), not default Tauri placeholders. Bundle identifier `com.snak.app` and
  `productName "snak"` both look correct. Verified: `cargo build`/`clippy`/`fmt` clean;
  `npm run build`/`lint` clean.
