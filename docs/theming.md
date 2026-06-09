# Authoring a theme (T11)

A **theme** recolors the app by overriding its CSS custom properties. Themes are
installable: you drop a folder into the app's themes directory and select it in
**Settings → Themes**. A theme composes with the light/dark setting — it only
overrides color (and a few sizing) variables, so the light/dark toggle still
works on top of it.

## Theme folder format

A theme is a folder containing exactly two files:

```
my-theme/
  theme.json    # manifest
  theme.css     # CSS overriding the documented variables
```

The **folder name** is the theme's id (its stable selection key), so keep it
unique and filesystem-friendly (e.g. `solarized`, `nord-dark`).

### `theme.json` (manifest)

```json
{
  "name": "Solarized",
  "author": "Your Name",
  "version": "1.0.0"
}
```

| Field     | Required | Notes                                  |
| --------- | -------- | -------------------------------------- |
| `name`    | yes      | Display name shown in the picker.      |
| `version` | yes      | Free-form version string (e.g. semver).|
| `author`  | no       | Shown as “by …” in the picker.         |

A folder missing/with an invalid `theme.json` or `theme.css` is silently skipped
when listing themes (it never breaks the rest of the list).

### `theme.css` (the stylesheet)

Override any of the documented variables (below). The app injects this CSS into
a single `<style id="installed-theme">` element appended to `<head>` after the
base stylesheet, so your overrides win by cascade. Colors use the
[oklch()](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch)
color space (you can also use any other CSS color syntax).

To support both light and dark, scope your dark overrides under `.dark`:

```css
:root {
  --background: oklch(0.98 0.02 95);
  --foreground: oklch(0.3 0.03 50);
  --primary: oklch(0.55 0.12 230);
  --primary-foreground: oklch(0.98 0.02 95);
}

.dark {
  --background: oklch(0.2 0.02 250);
  --foreground: oklch(0.95 0.01 95);
  --primary: oklch(0.7 0.12 230);
  --primary-foreground: oklch(0.2 0.02 250);
}
```

You only need to override the variables you want to change; anything you leave
out keeps the built-in value. If you don't scope under `.dark`, your `:root`
values apply in both modes.

## Documented CSS variables

These are defined in `src/index.css` and are the supported theming surface.

Core palette:

- `--background`, `--foreground`
- `--card`, `--card-foreground`
- `--popover`, `--popover-foreground`
- `--primary`, `--primary-foreground`
- `--secondary`, `--secondary-foreground`
- `--muted`, `--muted-foreground`
- `--accent`, `--accent-foreground`
- `--destructive`
- `--border`, `--input`, `--ring`

Sidebar:

- `--sidebar`, `--sidebar-foreground`
- `--sidebar-primary`, `--sidebar-primary-foreground`
- `--sidebar-accent`, `--sidebar-accent-foreground`
- `--sidebar-border`, `--sidebar-ring`

Charts: `--chart-1` … `--chart-5`

Sizing: `--radius` (base corner radius; the `--radius-*` scale derives from it).

## Installing & selecting

1. Open **Settings → Themes** and click **Show themes folder** to reveal the
   app-data themes directory (it's created on demand).
2. Drop your theme folder in there.
3. Click **Refresh**, then **Use** next to your theme. Pick **Default** to
   revert to the built-in palette.

Your selection is remembered across restarts (stored alongside the light/dark
preference) and re-applied at startup.

## Relationship to the plugin system (T12)

The plugin system has a `theme` category whose contribution is `{ name, css }`
with the CSS inlined in `manifest.json`. Enabled `theme` plugins also appear in
the Themes picker (marked `plugin`), so both sources share one selector. The
themes-folder format documented here is the simpler authoring path when you just
want to ship a stylesheet without writing a full plugin manifest.

## Security

Themes are **CSS only**. The app reads `theme.css` as text and injects it via a
`<style>` element — it never executes theme code, loads `<script>`, or fetches
remote resources on your behalf. Avoid `@import url(...)` of remote stylesheets;
keep everything in the one `theme.css`.
