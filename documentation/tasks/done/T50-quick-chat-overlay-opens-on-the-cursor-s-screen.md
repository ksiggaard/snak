# T50 — Quick-chat overlay opens on the cursor's screen

- **Status:** done
- **Owner:** Claude (T50)
- **Priority:** P2
- **Layer:** Rust
- **Depends on:** —

(IDEAS 21.) On multi-monitor setups the overlay should appear on the screen where the mouse
cursor is.

**Notes:**
- 2026-06-13 (Claude): `commands/quick.rs` `show_quick` now repositions on every show, anchoring
  lower-middle on the monitor under the cursor (`w.cursor_position()` + `w.monitor_from_point`,
  falling back to `current_monitor`/`center`). Dropped the `POSITIONED`-once guard so it follows
  the cursor across monitors. Verified: `cargo build`/`clippy`/`fmt --check`/`test`.
