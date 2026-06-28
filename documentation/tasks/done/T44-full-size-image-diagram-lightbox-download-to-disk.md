# T44 — Full-size image/diagram lightbox + download-to-disk

- **Status:** done
- **Owner:** Claude (T44)
- **Priority:** P2
- **Layer:** Frontend + Rust (native save dialog)
- **Depends on:** T8 (Markdown/code rendering), T42 (Mermaid)

A single shared full-size viewer for images and rendered Mermaid diagrams, openable from
anywhere (message images, the right-side chat panel's media gallery, and diagrams), with a
native "Save as…" download. Replaces the panel-local lightbox that previously only the media
gallery had.

**Acceptance criteria:**
- One `<ImageLightbox>` mounted at the app root (like `ConfirmDialog`), driven by a
  `useLightbox` store; backdrop / Esc / X close it.
- Clicking a message image, a panel-gallery thumbnail, or a Mermaid diagram opens it full-size.
- A **Download** button saves the content via a native save dialog (image → original format,
  diagram → `.svg`); the bytes are written from Rust (webview only holds base64) — no JS
  filesystem capability.
- When opened from the gallery (entry carries a `messageId`) it offers a "Go to message" jump.

**Notes:**
- 2026-06-13 (Claude): Implemented. New `src/store/lightbox.ts` (content = stored image or SVG;
  imperative `openLightbox`/`openLightboxSvg` helpers), `src/components/ImageLightbox.tsx`
  (mounted in `App.tsx`), `src/lib/images.ts` (`downloadImage`/`downloadSvg`/`fitSvg`). Rust
  `commands/files.rs::save_image` (base64 decode + `tauri-plugin-dialog` `blocking_save_file`),
  registered in `lib.rs`; added `dialog:default` to `capabilities/default.json` and the
  `tauri-plugin-dialog` dep. `MessageList`/`ChatPanel`/`Mermaid` now open the shared viewer
  (the panel's old local `Lightbox` was removed). 5 new `chat.*` i18n keys
  (`viewImage`/`viewDiagram`/`downloadImage`/`imageSaved`/`imageSaveFailed`) in the catalog +
  all five locale packs (the `panel.goToMessage`/`panel.close` keys it reuses already existed).
  Verified: `npm test` (446), `npm run build`/`lint`, `cargo check` all green.
