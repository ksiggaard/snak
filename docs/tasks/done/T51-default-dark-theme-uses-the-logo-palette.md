# T51 — Default dark theme uses the logo palette

- **Status:** done
- **Owner:** Claude (T51)
- **Priority:** P3
- **Layer:** Frontend
- **Depends on:** T30 (color pickers)

(IDEAS 22.) Make the default dark theme match the logo: accent `#dc8add`, background
`#163e54`, mix `#000000`.

**Notes:**
- 2026-06-13 (Claude): The real default dark theme is the `.dark` block in `index.css` (the
  picker's `DEFAULT_PICKER_COLORS` is only a swatch seed). Baked the logo palette into `.dark`
  using the exact output of the existing color pipeline (`buildColorCss`/`derivedSurfaceDecls`/
  `tintedBackground`) for those three picks — kept at the base layer so installed themes (T11)
  and user picker overrides still win by load order/specificity. `--destructive`/`--chart-*`/
  `--sidebar-primary*` left as-is. `DEFAULT_PICKER_COLORS.dark` updated to match so the
  Appearance swatches + reset target the new defaults; light mode unchanged. Verified: full
  frontend gate.
