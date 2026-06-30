---
name: release
description: How to cut a snak release — bump the version across all manifests, commit, and tag, matching the repo's release convention. Use when asked to "release", "cut a version", "bump to vX.Y.Z", or "tag a release".
---

# Cutting a release

snak releases are a synchronized version bump across **three** manifests plus the lockfile, a
`chore(release)` commit, and a matching `vX.Y.Z` tag. Confirm the target version with the user
first; follow semver.

## Bump the version in all four places (keep them identical)

1. **`package.json`** — `"version": "X.Y.Z"`.
2. **`src-tauri/tauri.conf.json`** — `"version": "X.Y.Z"`.
3. **`src-tauri/Cargo.toml`** — `version = "X.Y.Z"`.
4. **`src-tauri/Cargo.lock`** — the `[[package]] name = "snak"` entry's `version`. Running
   `cargo build` in `src-tauri/` updates this for you (don't hand-edit if you can build).

## Commit & tag (matches existing history)

```
git add -A
git commit -m "chore(release): vX.Y.Z"
git tag vX.Y.Z
```

The commit message format is exactly `chore(release): vX.Y.Z` (see `git log`). Tags are
`vX.Y.Z`. Only push when the user asks (`git push && git push --tags`).

## Verify before tagging

Run the full gate (see the `/preflight` command):
`npm run build`, `npm run lint`, and `cargo clippy` + `cargo fmt --check` in `src-tauri/`.

## Packaging (when producing artifacts)

`npm run tauri build` produces `.deb`/`.rpm`/AppImage. **On Arch-based systems the AppImage step
needs `NO_STRIP=true npm run tauri build`** — linuxdeploy's bundled `strip` can't read modern
`.relr.dyn` ELF sections. Inline media playback also needs the GStreamer `gst-plugins-*` packages
(optional; see `AGENTS.md` §Toolchain).
