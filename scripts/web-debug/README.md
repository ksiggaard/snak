# Web-debug scripts

Headless checks that drive the app in **web-only mode** (see `AGENTS.md` →
"Web-only mode") with real Chrome via `playwright-core`. Useful for reproducing
and regression-testing frontend behaviour that only shows up in a running
browser (scroll-follow, streaming) without the Tauri build.

## scroll-check.mjs

Asserts the chat scroll behaviours that were historically fragile:

1. follows the stream while parked at the bottom,
2. scrolling up mid-stream disengages (no yank-back),
3. sending after scrolling up jumps to the bottom,
4. a sent message persists across a reload (localStorage-backed fake DB).

### Run

```sh
npm run dev                      # terminal 1 — serves http://localhost:1420
npm run scroll-check             # terminal 2 — runs the checks (exits non-zero on failure)
```

Env overrides:

- `APP_URL` — app URL (default `http://localhost:1420`).
- `CHROME_BIN` — path to a Chrome/Chromium binary if the `chrome` channel can't
  be found (e.g. `CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`).
