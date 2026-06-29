# T54 — Mermaid diagram background when enlarged

- **Status:** done
- **Owner:** Claude (T54)
- **Priority:** P3
- **Layer:** Frontend
- **Depends on:** T42 (Mermaid), T44 (lightbox)

(IDEA 25.) An enlarged Mermaid diagram (the lightbox) had no background, so it sat transparent
on the dark backdrop. Add a themed background behind the enlarged diagram (and bake it into the
downloaded SVG). Inline in-chat diagrams are unchanged.

**Notes:**
- 2026-06-13 (Claude): `src/lib/images.ts` gained `withSvgBackground(svg, bg)` (inserts an opaque
  `<rect>` covering the `viewBox`, falling back to 100%, as the first child); `fitSvg(svg, bg?)` and
  `downloadSvg(svg, bg?)` thread it through so both the on-screen enlargement and the saved `.svg`
  carry the background. The lightbox store's svg content gained an optional `bg`; `Mermaid` resolves
  it from `--card` at click time via the new `resolveCssVarColor` helper in `lib/theme.ts` (probes a
  throwaway element so the active/installed theme — oklch, hex, or override — normalises to a
  portable `rgb()`). `ImageLightbox` also sets the wrapper `bg-card` + padding so the letterbox
  margins read as a card. Unit-tested in `images.test.ts`. Verified: `npm run build`/`lint`/`test`.
