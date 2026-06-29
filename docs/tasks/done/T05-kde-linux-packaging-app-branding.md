# T5 — KDE/Linux packaging + app branding

- **Status:** done
- **Owner:** Claude (orchestrator) — Linux slice
- **Priority:** P2
- **Layer:** Tooling / config (Rust bundle) + assets
- **Depends on:** —

`npm run tauri build` is intended to produce AppImage/.deb for KDE. `bundle.targets` is
`"all"` but this hasn't been verified on Linux, and the icons appear to be the default
Tauri placeholders.

**Acceptance criteria:**
- Produce real app icons/branding (replace default Tauri icons in `src-tauri/icons/`).
- Verify `npm run tauri build` yields a working AppImage and/or `.deb` on KDE/Linux;
  document any extra system deps required.
- Confirm the global shortcut, tray (T1), and screenshot (`spectacle -r`) work in the
  packaged build on a real KDE session.

**Notes:**
- This requires a Linux/KDE environment; the dev machine is macOS. Mark `blocked` if no
  KDE target is available and note that.
- 2026-06-10 (WS-A): **macOS slice done** alongside T26 — `src-tauri/Info.plist` (new) carries
  `NSScreenCaptureUsageDescription`, wired via `bundle.macOS.infoPlist` in `tauri.conf.json`,
  so packaged builds can be granted Screen Recording. Confirmed `src-tauri/icons/` are real
  `snak` branding (not Tauri placeholders) and `productName`/`com.snak.app` are correct.
  **Still BLOCKED:** producing/verifying the AppImage + `.deb` and confirming the tray, global
  shortcut, and `spectacle -r` on a real KDE session — needs a Linux/KDE machine (dev box is
  macOS). Pick this up on a KDE target.
- 2026-06-12 (Claude, orchestrator): **Linux packaging slice done on a real KDE box (CachyOS/
  Arch).** `npm run tauri build` produced `snak_0.1.0_amd64.deb` (8.3 MB) and
  `snak-0.1.0-1.x86_64.rpm` cleanly; the AppImage step initially failed with
  `failed to run linuxdeploy` — root cause: linuxdeploy's bundled `strip` (old binutils)
  can't read the `.relr.dyn` (SHT_RELR) ELF sections emitted by modern Arch toolchains.
  Workaround (documented upstream): run with **`NO_STRIP=true npm run tauri build`** —
  produces `snak_0.1.0_amd64.AppImage` (106 MB). No other extra system deps were needed
  (fuse2 was already present; linuxdeploy is auto-downloaded to `~/.cache/tauri`).
  **2026-06-12 (later):** Kasper confirmed the packaged AppImage in the live KDE session:
  tray icon (sharp after switching the embedded tray asset from `icons/32x32.png` to
  `icons/128x128.png` in `lib.rs` — KDE panels render above 32px), global shortcut
  (Alt+Space), and `spectacle -r` screenshot capture all work. All acceptance criteria met.
