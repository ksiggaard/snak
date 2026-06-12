// Custom appearance overrides (T30 colors + T33 typography).
//
// Both features persist in localStorage (mirroring `lib/theme.ts` — pure UI
// concerns, read synchronously at startup with no flash) and apply as CSS
// injected into dedicated `<style>` elements (`#custom-colors` and
// `#custom-typography`), the same mechanism as `applyInstalledThemeCss`.
//
// Precedence — custom picks override the active installed/plugin theme. The
// color overrides use doubled-specificity selectors (`:root:not(.dark)` /
// `:root.dark`, mirrored on `body` for the WebKitGTK portal quirk — see
// `applyTheme`), which beat a theme's single-class `:root` / `.dark` rules
// regardless of `<style>` element order. Typography rules are unlayered, so
// they also beat Tailwind's layered base/utility declarations.
//
// Color picks are **per-mode**: a pick made while light mode is active is
// stored under `light` and only emitted for the light scope (and vice versa),
// so light and dark can be customized independently.

export type ColorMode = "light" | "dark";
export type ColorKey = "primary" | "background";

export interface ModeColors {
  /** Accent (`--primary`) hex pick, e.g. "#3b82f6". */
  primary?: string;
  /** Background (`--background`) hex pick. */
  background?: string;
}

export interface CustomColors {
  light: ModeColors;
  dark: ModeColors;
}

export interface TypographyPrefs {
  /** UI font family (raw user/curated value, not yet CSS-escaped). */
  uiFont: string | null;
  /** Chat message-content font family. */
  chatFont: string | null;
  /** Root (UI) font size in px — scales all rem-based sizing. */
  uiSize: number | null;
  /** Chat message-content font size in px. */
  chatSize: number | null;
}

export interface SizeRange {
  min: number;
  max: number;
  /** The effective default when no custom size is set (display only). */
  fallback: number;
}

/** Root font-size bounds (px). Default browser root is 16px. */
export const UI_SIZE: SizeRange = { min: 13, max: 18, fallback: 16 };
/** Chat content font-size bounds (px). Default chat text is text-sm = 14px. */
export const CHAT_SIZE: SizeRange = { min: 14, max: 20, fallback: 14 };

const COLORS_KEY = "custom-colors";
const TYPOGRAPHY_KEY = "custom-typography";
const COLORS_STYLE_ID = "custom-colors";
const TYPOGRAPHY_STYLE_ID = "custom-typography";

// ── Chat layout style (T34) & chat-list row style (T35) ─────────────────────
//
// Pure render-mode preferences (no CSS injection): components read them from
// `useAppearance` and branch their markup/classes. Persisted in localStorage
// and seeded synchronously at store init, like every other appearance pref.

/** How chat messages render in `MessageList` (T34). */
export type ChatStyle = "default" | "bubbles" | "compact" | "document";

/** What a sidebar thread row shows (T35). */
export type ChatListStyle = "title" | "title-date" | "detailed" | "preview";

export const CHAT_STYLES: { value: ChatStyle; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "bubbles", label: "Bubbles" },
  { value: "compact", label: "Compact" },
  { value: "document", label: "Document" },
];

export const CHAT_LIST_STYLES: { value: ChatListStyle; label: string }[] = [
  { value: "title", label: "Title" },
  { value: "title-date", label: "Title + date" },
  { value: "detailed", label: "Detailed" },
  { value: "preview", label: "Preview" },
];

const CHAT_STYLE_KEY = "chat-style";
const CHAT_LIST_STYLE_KEY = "chat-list-style";

export function getStoredChatStyle(): ChatStyle {
  const raw = localStorage.getItem(CHAT_STYLE_KEY);
  return CHAT_STYLES.some((s) => s.value === raw)
    ? (raw as ChatStyle)
    : "default";
}

export function storeChatStyle(style: ChatStyle): void {
  if (style === "default") localStorage.removeItem(CHAT_STYLE_KEY);
  else localStorage.setItem(CHAT_STYLE_KEY, style);
}

export function getStoredChatListStyle(): ChatListStyle {
  const raw = localStorage.getItem(CHAT_LIST_STYLE_KEY);
  return CHAT_LIST_STYLES.some((s) => s.value === raw)
    ? (raw as ChatListStyle)
    : "title";
}

export function storeChatListStyle(style: ChatListStyle): void {
  if (style === "title") localStorage.removeItem(CHAT_LIST_STYLE_KEY);
  else localStorage.setItem(CHAT_LIST_STYLE_KEY, style);
}

/**
 * sRGB approximations of the built-in palette's tokens, used only to seed the
 * native color inputs when no custom pick is stored (an `<input type="color">`
 * can't display an oklch() string). If an installed theme changes the palette,
 * the seed may not match it — a known display-only limitation.
 */
export const DEFAULT_PICKER_COLORS: Record<ColorMode, Required<ModeColors>> = {
  light: { primary: "#171717", background: "#ffffff" },
  dark: { primary: "#e5e5e5", background: "#0a0a0a" },
};

export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}

// ── Persistence ──────────────────────────────────────────────────────────────

function sanitizeModeColors(v: unknown): ModeColors {
  if (typeof v !== "object" || v === null) return {};
  const m = v as Record<string, unknown>;
  const out: ModeColors = {};
  if (isHexColor(m.primary)) out.primary = m.primary.toLowerCase();
  if (isHexColor(m.background)) out.background = m.background.toLowerCase();
  return out;
}

export function getStoredCustomColors(): CustomColors {
  try {
    const raw = localStorage.getItem(COLORS_KEY);
    if (!raw) return { light: {}, dark: {} };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      light: sanitizeModeColors(parsed.light),
      dark: sanitizeModeColors(parsed.dark),
    };
  } catch {
    return { light: {}, dark: {} };
  }
}

export function storeCustomColors(colors: CustomColors): void {
  const empty =
    Object.keys(colors.light).length === 0 &&
    Object.keys(colors.dark).length === 0;
  if (empty) localStorage.removeItem(COLORS_KEY);
  else localStorage.setItem(COLORS_KEY, JSON.stringify(colors));
}

export function clampSize(n: number, range: SizeRange): number {
  return Math.min(range.max, Math.max(range.min, Math.round(n)));
}

function sanitizeSize(v: unknown, range: SizeRange): number | null {
  return typeof v === "number" && Number.isFinite(v)
    ? clampSize(v, range)
    : null;
}

const EMPTY_TYPOGRAPHY: TypographyPrefs = {
  uiFont: null,
  chatFont: null,
  uiSize: null,
  chatSize: null,
};

export function getStoredTypography(): TypographyPrefs {
  try {
    const raw = localStorage.getItem(TYPOGRAPHY_KEY);
    if (!raw) return { ...EMPTY_TYPOGRAPHY };
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      uiFont: typeof p.uiFont === "string" && p.uiFont ? p.uiFont : null,
      chatFont:
        typeof p.chatFont === "string" && p.chatFont ? p.chatFont : null,
      uiSize: sanitizeSize(p.uiSize, UI_SIZE),
      chatSize: sanitizeSize(p.chatSize, CHAT_SIZE),
    };
  } catch {
    return { ...EMPTY_TYPOGRAPHY };
  }
}

export function storeTypography(t: TypographyPrefs): void {
  const empty =
    t.uiFont === null &&
    t.chatFont === null &&
    t.uiSize === null &&
    t.chatSize === null;
  if (empty) localStorage.removeItem(TYPOGRAPHY_KEY);
  else localStorage.setItem(TYPOGRAPHY_KEY, JSON.stringify(t));
}

// ── Contrast (T30) ───────────────────────────────────────────────────────────

/** WCAG relative luminance of a #rrggbb color (0 = black … 1 = white). */
export function relativeLuminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

const DARK_FOREGROUND = "#171717"; // ≈ the built-in light-mode --primary gray

/**
 * Foreground (text) color that contrasts best with `hex`: white for dark
 * colors, near-black for light ones. Used to keep `--primary-foreground` /
 * `--foreground` readable when the accent/background is customized.
 */
export function contrastForeground(hex: string): string {
  const l = relativeLuminance(hex);
  const contrastWhite = 1.05 / (l + 0.05);
  const contrastDark = (l + 0.05) / (relativeLuminance(DARK_FOREGROUND) + 0.05);
  return contrastWhite >= contrastDark ? "#ffffff" : DARK_FOREGROUND;
}

/** Mix two #rrggbb colors in sRGB: t = 0 → `a`, t = 1 → `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  const out = [1, 3, 5].map((i) => {
    const v = Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t);
    return Math.min(255, Math.max(0, v)).toString(16).padStart(2, "0");
  });
  return `#${out.join("")}`;
}

// Fractions mixed from the picked background toward its tonal pole (black for
// a light background, white for a dark one). Deliberately stronger than the
// built-in palette's near-flat ratios so the UI groupings stay visually
// separated on an arbitrary pick: the main background, the composer/cards
// (`--card`), and the sidebar + title/menu bar (`--sidebar`) each get a
// clearly distinct tone step.
const SURFACE_TONES = {
  card: 0.06,
  sidebar: 0.1,
  muted: 0.14,
  border: 0.18,
  ring: 0.32,
} as const;

/** How far `--muted-foreground` sits from the foreground back toward the
 * background (light default: fg 0.145 → muted-fg 0.556 over bg 1.0 ≈ 45%). */
const MUTED_FG_TONE = 0.4;

/**
 * Surface tokens derived from a picked background so the whole chrome —
 * sidebar, title/menu bar, cards, popovers, inputs, borders — follows the
 * pick as darker (light background) or lighter (dark background) tones,
 * instead of keeping the theme's surfaces and clashing.
 */
export function derivedSurfaceDecls(background: string): string[] {
  const pole =
    contrastForeground(background) === "#ffffff" ? "#ffffff" : "#000000";
  const tone = (t: number) => mixHex(background, pole, t);
  const fg = contrastForeground(background);
  const card = tone(SURFACE_TONES.card);
  const sidebar = tone(SURFACE_TONES.sidebar);
  const muted = tone(SURFACE_TONES.muted);
  const border = tone(SURFACE_TONES.border);
  const ring = tone(SURFACE_TONES.ring);
  const mutedFg = mixHex(fg, background, MUTED_FG_TONE);
  return [
    `--card: ${card};`,
    `--card-foreground: ${contrastForeground(card)};`,
    `--popover: ${card};`,
    `--popover-foreground: ${contrastForeground(card)};`,
    `--secondary: ${muted};`,
    `--secondary-foreground: ${contrastForeground(muted)};`,
    `--muted: ${muted};`,
    `--muted-foreground: ${mutedFg};`,
    `--accent: ${muted};`,
    `--accent-foreground: ${contrastForeground(muted)};`,
    `--border: ${border};`,
    `--input: ${border};`,
    `--ring: ${ring};`,
    `--sidebar: ${sidebar};`,
    `--sidebar-foreground: ${contrastForeground(sidebar)};`,
    `--sidebar-accent: ${muted};`,
    `--sidebar-accent-foreground: ${contrastForeground(muted)};`,
    `--sidebar-border: ${border};`,
    `--sidebar-ring: ${ring};`,
  ];
}

// ── Color override CSS (T30) ─────────────────────────────────────────────────

// Specificity (0,2,0) / (0,1,1) — beats a theme's `:root` / `.dark` (0,1,0)
// on both <html> and <body> (the dark class is mirrored on body for portals).
const LIGHT_SCOPE = ":root:not(.dark), body:not(.dark)";
const DARK_SCOPE = ":root.dark, body.dark";

function colorDecls(mc: ModeColors): string[] {
  const d: string[] = [];
  if (mc.primary) {
    d.push(`--primary: ${mc.primary};`);
    d.push(`--primary-foreground: ${contrastForeground(mc.primary)};`);
  }
  if (mc.background) {
    d.push(`--background: ${mc.background};`);
    d.push(`--foreground: ${contrastForeground(mc.background)};`);
    d.push(...derivedSurfaceDecls(mc.background));
  }
  return d;
}

/**
 * Build the CSS overriding the color tokens for any stored picks, plus their
 * computed readable foregrounds. A background pick additionally re-derives
 * the surface family (`--sidebar` incl. title/menu bar, `--card`/`--popover`,
 * `--muted`/`--secondary`/`--accent`, `--border`/`--input`, `--ring`) as
 * darker or lighter tones of the pick — see `derivedSurfaceDecls`.
 */
export function buildColorCss(colors: CustomColors): string {
  const blocks: string[] = [];
  const light = colorDecls(colors.light);
  const dark = colorDecls(colors.dark);
  if (light.length > 0)
    blocks.push(`${LIGHT_SCOPE} {\n  ${light.join("\n  ")}\n}`);
  if (dark.length > 0)
    blocks.push(`${DARK_SCOPE} {\n  ${dark.join("\n  ")}\n}`);
  return blocks.join("\n");
}

// ── Typography override CSS (T33) ────────────────────────────────────────────

const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
]);

/**
 * Turn a user-entered/curated family string ("Open Sans" or "Georgia, serif")
 * into a safe CSS font-family value: strips characters that could break out of
 * the declaration, quotes non-generic names, and appends a `sans-serif`
 * fallback when none is given. Returns null when nothing usable remains.
 */
export function cssFontFamily(input: string): string | null {
  const cleaned = input.replace(/[;:{}<>\\"'\n\r]/g, "").trim();
  if (!cleaned) return null;
  const parts = cleaned
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const out = parts.map((p) =>
    GENERIC_FAMILIES.has(p.toLowerCase()) ? p.toLowerCase() : `"${p}"`,
  );
  if (!GENERIC_FAMILIES.has(parts[parts.length - 1].toLowerCase()))
    out.push("sans-serif");
  return out.join(", ");
}

/** Curated font choices (T33). Values are raw family strings fed through
 * `cssFontFamily`; availability relies on the OS (no font is bundled besides
 * the Geist default). A free-text input is the escape hatch for anything else. */
export const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: "System default", value: "system-ui" },
  { label: "Inter", value: "Inter" },
  { label: "Roboto", value: "Roboto" },
  { label: "Open Sans", value: "Open Sans" },
  { label: "Noto Sans", value: "Noto Sans" },
  { label: "Lato", value: "Lato" },
  { label: "Source Sans 3", value: "Source Sans 3" },
  { label: "Georgia (serif)", value: "Georgia, serif" },
  { label: "Noto Serif", value: "Noto Serif, serif" },
  { label: "System serif", value: "serif" },
  { label: "JetBrains Mono", value: "JetBrains Mono, monospace" },
  { label: "System monospace", value: "monospace" },
];

/**
 * Build the CSS applying the typography prefs.
 *
 * - UI family sets `--font-sans` (the documented token) **and** an explicit
 *   `font-family` on html/body + the `font-sans`/`font-heading` utilities —
 *   Tailwind v4's `@theme inline` inlines token values into utilities, so
 *   overriding the variable alone wouldn't restyle them.
 * - UI size sets the root font-size (rem-based sizing scales with it).
 * - Chat family/size set `--font-chat` / `--chat-font-size`, consumed by the
 *   `.chat-content` wrapper that `MessageList` puts on each message's content.
 *   Inner `text-sm` utilities are neutralized to `inherit` (and `text-base`/
 *   `text-lg` headings remapped to em) so the pick actually reaches the prose;
 *   code blocks keep their own `font-mono` stack untouched.
 */
export function buildTypographyCss(t: TypographyPrefs): string {
  const parts: string[] = [];
  const ui = t.uiFont ? cssFontFamily(t.uiFont) : null;
  if (ui) {
    parts.push(`:root { --font-sans: ${ui}; }`);
    parts.push(`html, body, .font-sans, .font-heading { font-family: ${ui}; }`);
  }
  if (t.uiSize !== null)
    parts.push(`html { font-size: ${clampSize(t.uiSize, UI_SIZE)}px; }`);
  const chat = t.chatFont ? cssFontFamily(t.chatFont) : null;
  if (chat) {
    parts.push(`:root { --font-chat: ${chat}; }`);
    parts.push(`.chat-content { font-family: var(--font-chat); }`);
  }
  if (t.chatSize !== null) {
    parts.push(
      `:root { --chat-font-size: ${clampSize(t.chatSize, CHAT_SIZE)}px; }`,
    );
    parts.push(`.chat-content { font-size: var(--chat-font-size); }`);
    parts.push(`.chat-content :where(.text-sm) { font-size: inherit; }`);
    parts.push(`.chat-content :where(.text-base) { font-size: 1.15em; }`);
    parts.push(`.chat-content :where(.text-lg) { font-size: 1.3em; }`);
  }
  return parts.join("\n");
}

// ── Injection ────────────────────────────────────────────────────────────────

/** Inject (or replace) CSS in a `<style id=…>`; empty CSS removes it. Mirrors
 * `applyInstalledThemeCss` in `lib/theme.ts`. */
function injectStyle(id: string, css: string): void {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!css) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

export function applyCustomColors(colors: CustomColors): void {
  injectStyle(COLORS_STYLE_ID, buildColorCss(colors));
}

export function applyCustomTypography(t: TypographyPrefs): void {
  injectStyle(TYPOGRAPHY_STYLE_ID, buildTypographyCss(t));
}
