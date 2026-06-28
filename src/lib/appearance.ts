// Custom appearance overrides (T30 colors + T33 typography).
//
// Both features persist in localStorage (mirroring `lib/theme.ts` — pure UI
// concerns, read synchronously at startup with no flash) and apply as CSS
// injected into dedicated `<style>` elements (`#custom-colors` and
// `#custom-typography`).
//
// Precedence — custom picks override the base palette. The color overrides use
// doubled-specificity selectors (`:root:not(.dark)` / `:root.dark`, mirrored
// on `body` for the WebKitGTK portal quirk — see `applyTheme`), which beat
// single-class `:root` / `.dark` rules regardless of `<style>` element order.
// Typography rules are unlayered, so they also beat Tailwind's layered
// base/utility declarations.
//
// Color picks are **per-mode**: a pick made while light mode is active is
// stored under `light` and only emitted for the light scope (and vice versa),
// so light and dark can be customized independently.

export type ColorMode = "light" | "dark";
export type ColorKey =
  | "primary"
  | "background"
  | "canvas"
  | "surface"
  | "accent"
  | "tint";

export interface ModeColors {
  /** Accent (`--primary`) hex pick, e.g. "#3b82f6". */
  primary?: string;
  /** Background (`--background`) hex pick. */
  background?: string;
  /** Canvas (`--canvas`) hex pick — the shade behind the floating cards. */
  canvas?: string;
  /** Secondary mix color the derived surfaces blend toward (defaults to the
   * background's tonal pole — black on a light pick, white on a dark one). */
  surface?: string;
  /** UI interaction color (`--accent`), distinct from primary. */
  accent?: string;
  /** Gradient tint color (`--tint`), blended with background. */
  tint?: string;
  /** Multiplier on the derived-surface tone steps (see `CONTRAST`). */
  contrast?: number;
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
/** Corner-radius bounds (px) for the `--radius` token every rounded-* size
 * derives from. Default is the built-in 0.625rem = 10px; 0 = sharp corners. */
export const RADIUS: SizeRange = { min: 0, max: 20, fallback: 10 };
/** Chat column max-width bounds (px). Caps message + composer width on wide
 * windows and centers the conversation; default 760 (cap on). `null` = off
 * (full width). Consumed via React props, not injected CSS — see store. */
export const CHAT_WIDTH: SizeRange = { min: 560, max: 1280, fallback: 760 };

const COLORS_KEY = "custom-colors";
const TYPOGRAPHY_KEY = "custom-typography";
const RADIUS_KEY = "custom-radius";
const CHAT_WIDTH_KEY = "chat-max-width";
const ANIMATIONS_KEY = "animations";
const DENSITY_KEY = "density";
const BG_GRADIENT_KEY = "bg-gradient";
const COLORS_STYLE_ID = "custom-colors";
const TYPOGRAPHY_STYLE_ID = "custom-typography";
const RADIUS_STYLE_ID = "custom-radius";
const DENSITY_STYLE_ID = "custom-density";
const GRADIENT_STYLE_ID = "custom-gradient";

// ── UI animations (T46) ─────────────────────────────────────────────────────
// A single global on/off. Enabled by default; when off, a `.no-animations`
// class on <html> neutralizes transitions/animations app-wide (see index.css).

/** Whether UI animations are enabled. Default on; only "0" disables. */
export function getStoredAnimations(): boolean {
  return localStorage.getItem(ANIMATIONS_KEY) !== "0";
}

export function storeAnimations(enabled: boolean): void {
  if (enabled) localStorage.removeItem(ANIMATIONS_KEY);
  else localStorage.setItem(ANIMATIONS_KEY, "0");
}

/** Toggle the `.no-animations` kill-switch class on <html>. */
export function applyAnimations(enabled: boolean): void {
  document.documentElement.classList.toggle("no-animations", !enabled);
}

// ── UI density (spacing scale) ───────────────────────────────────────────────
// 0 = compact (~today's density), 1 = default (airy), 2 = comfortable (generous).
// Drives a --density-scale CSS variable that components reference via calc().

export type Density = 0 | 1 | 2;

export const DENSITY_SCALE: Record<Density, number> = { 0: 0.75, 1: 1, 2: 1.75 };

export const DENSITY_LABELS: Record<Density, string> = {
  0: "Compact",
  1: "Default",
  2: "Comfortable",
};

export function getStoredDensity(): Density {
  const raw = localStorage.getItem(DENSITY_KEY);
  if (raw === "0") return 0;
  if (raw === "2") return 2;
  return 1;
}

export function storeDensity(d: Density): void {
  if (d === 1) localStorage.removeItem(DENSITY_KEY);
  else localStorage.setItem(DENSITY_KEY, String(d));
}

export function applyDensity(d: Density): void {
  const scale = DENSITY_SCALE[d];
  const css = `:root { --density-scale: ${scale}; }`;
  injectStyle(DENSITY_STYLE_ID, d === 1 ? "" : css);
}

// ── Background gradient ──────────────────────────────────────────────────────
// A subtle linear gradient blending the main background toward the tint color.
// Off by default; toggle in Appearance.

export function getStoredBgGradient(): boolean {
  return localStorage.getItem(BG_GRADIENT_KEY) === "1";
}

export function storeBgGradient(enabled: boolean): void {
  if (enabled) localStorage.setItem(BG_GRADIENT_KEY, "1");
  else localStorage.removeItem(BG_GRADIENT_KEY);
}

export function applyBgGradient(enabled: boolean): void {
  if (!enabled) {
    injectStyle(GRADIENT_STYLE_ID, "");
    return;
  }
  const css = `
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      z-index: 0;
      pointer-events: none;
      background: linear-gradient(135deg, var(--background), var(--tint));
      opacity: 0.06;
    }
    #root {
      position: relative;
      z-index: 1;
    }
  `;
  injectStyle(GRADIENT_STYLE_ID, css);
}

// ── Chat layout style (T34) & chat-list row style (T35) ─────────────────────
//
// Pure render-mode preferences (no CSS injection): components read them from
// `useAppearance` and branch their markup/classes. Persisted in localStorage
// and seeded synchronously at store init, like every other appearance pref.

/** How chat messages render in `MessageList` (T34). */
export type ChatStyle =
  | "default"
  | "bubbles"
  | "compact"
  | "document"
  | "cards"
  | "cozy"
  | "terminal"
  | "zebra";

/** What a sidebar thread row shows (T35). */
export type ChatListStyle =
  | "title"
  | "title-date"
  | "detailed"
  | "preview"
  | "inline"
  | "icon"
  | "compact"
  | "full";

export const CHAT_STYLES: { value: ChatStyle; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "bubbles", label: "Bubbles" },
  { value: "compact", label: "Compact" },
  { value: "document", label: "Document" },
  { value: "cards", label: "Cards" },
  { value: "cozy", label: "Cozy" },
  { value: "terminal", label: "Terminal" },
  { value: "zebra", label: "Zebra" },
];

export const CHAT_LIST_STYLES: { value: ChatListStyle; label: string }[] = [
  { value: "title", label: "Title" },
  { value: "title-date", label: "Title + date" },
  { value: "detailed", label: "Detailed" },
  { value: "preview", label: "Preview" },
  { value: "inline", label: "Inline date" },
  { value: "icon", label: "Icon" },
  { value: "compact", label: "Compact" },
  { value: "full", label: "Full" },
];

/** Row styles whose subline shows a last-message snippet — drives the one
 * sidebar-wide snippet query (see `useThreadSnippets`). */
export function listStyleShowsSnippet(style: ChatListStyle): boolean {
  return style === "preview" || style === "full";
}

const CHAT_STYLE_KEY = "chat-style";
const CHAT_LIST_STYLE_KEY = "chat-list-style";

/** Scroll-column gap/padding per chat style, shared by `MessageList` and the
 * settings chat-style preview so the message rhythm matches. */
export const CHAT_CONTAINER_CLASSES: Record<ChatStyle, string> = {
  default: "gap-6 p-6",
  bubbles: "gap-6 p-6",
  compact: "gap-1 p-2",
  document: "gap-7 p-6",
  cards: "gap-5 p-6",
  cozy: "gap-7 p-6",
  terminal: "gap-2 p-3",
  zebra: "gap-2 p-4",
};

/** Base horizontal padding (CSS length) per chat style — the `px` half of
 * CHAT_CONTAINER_CLASSES's `p-*` (p-4 → 1rem, p-3 → 0.75rem, p-2 → 0.5rem). The
 * composer column (`ChatView`) uses this as its left padding and
 * `base + var(--snak-scrollbar-width)` as its right padding, so it lines up with
 * the message column — whose scroll container reserves a matching scrollbar
 * gutter on the right (`scrollbar-gutter: stable`). **Keep in sync with
 * CHAT_CONTAINER_CLASSES.** */
export const CHAT_X_PADDING: Record<ChatStyle, string> = {
  default: "1.5rem",
  bubbles: "1.5rem",
  compact: "0.5rem",
  document: "1.5rem",
  cards: "1.5rem",
  cozy: "1.5rem",
  terminal: "0.75rem",
  zebra: "1rem",
};

// ── Scrollbar width (chat composer ↔ message-column alignment) ───────────────
//
// The message scroll container (MessageList) reserves a `scrollbar-gutter` on
// its right edge. A classic (space-taking) scrollbar — macOS "Automatic" with a
// mouse attached, or WebKitGTK — is ~15px wide; an overlay scrollbar (trackpad)
// is 0. The composer, which doesn't scroll, can't reserve a gutter the same way
// (an `overflow` ancestor would clip the upward-opening model-picker popover),
// so instead it pads its right edge by the measured width, published here as a
// CSS variable. 0 (overlay) makes the whole thing a no-op.

/** CSS custom property (set on `<html>`) holding the OS scrollbar width in px. */
export const SCROLLBAR_WIDTH_VAR = "--snak-scrollbar-width";

/** Measure the vertical scrollbar's layout width via an offscreen probe. */
export function measureScrollbarWidth(): number {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll;visibility:hidden";
  (document.body ?? document.documentElement).appendChild(probe);
  const width = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return width;
}

/** Re-measure the scrollbar width and publish it as the CSS variable. Safe to
 * call repeatedly — the width can change at runtime when a mouse is (un)plugged
 * under macOS's "Automatic" scrollbar setting (overlay ↔ classic). */
export function applyScrollbarWidth(): void {
  document.documentElement.style.setProperty(
    SCROLLBAR_WIDTH_VAR,
    `${measureScrollbarWidth()}px`,
  );
}

/** Per-chat-style classes for a message row + its content wrapper (T34).
 * Compact, cozy, and terminal have their own markup (gutter/avatar/prompt
 * prefixes) and don't use this table. Shared by `MessageList` and the settings
 * chat-style preview (`ChatStylePreview` in `Appearance.tsx`) so the preview
 * can't drift. */
export function styleClasses(
  style: ChatStyle,
  isUser: boolean,
): { row: string; content: string } {
  switch (style) {
    case "bubbles":
      // Messenger-style. The assistant bubble carries `bubble-assistant` so
      // wide content (code/tables) lets it break out of the 75% cap — see the
      // `:has(pre, table)` rule in index.css — instead of squishing.
      return {
        row: isUser ? "justify-end" : "justify-start",
        content: isUser
          ? "bg-primary/10 max-w-[75%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm"
          : "bubble-assistant bg-muted text-foreground max-w-[75%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm",
      };
    case "document":
      // Reading mode: user prompts as section headings/quotes, assistant
      // prose flows full-width like an article.
      return {
        row: "justify-start",
        content: isUser
          ? "border-primary/60 w-full max-w-full border-l-2 py-0.5 pl-3 text-base font-semibold"
          : "text-foreground w-full max-w-full text-sm",
      };
    case "cards":
      // Forum/email-thread feel: every message is a full-width bordered card;
      // user cards are accent-tinted so roles stay distinguishable.
      return {
        row: "justify-start",
        content: isUser
          ? "border-primary/35 bg-primary/5 w-full max-w-full rounded-lg border px-3.5 py-2.5 text-sm"
          : "bg-card shadow-xs w-full max-w-full rounded-lg border px-3.5 py-2.5 text-sm",
      };
    case "zebra":
      // Striped log: full-width rows with no bubbles or borders — user
      // messages sit on a soft tinted band, assistant replies on the plain
      // background. Content padding matches the band's so text stays aligned.
      return {
        row: isUser ? "bg-muted/60 rounded-md" : "",
        content: "w-full max-w-full px-3 py-2 text-sm",
      };
    default:
      // "default": the original flat full-width layout, unchanged.
      return {
        row: isUser ? "justify-end" : "justify-start",
        content: isUser
          ? "bg-primary text-primary-foreground max-w-[80%] rounded-lg px-3 py-2 text-sm"
          : "text-foreground w-full max-w-full text-sm",
      };
  }
}

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
export const DEFAULT_PICKER_COLORS: Record<
  ColorMode,
  Record<ColorKey, string>
> = {
  light: {
    primary: "#3858d6",
    background: "#fafbfc",
    canvas: "#eef0f3",
    surface: "#b8c8e0",
    accent: "#88bbee",
    tint: "#c9daf0",
  },
  dark: {
    primary: "#f472b6",
    background: "#0b1a2e",
    canvas: "#060e18",
    surface: "#1a3d5c",
    accent: "#3b5998",
    tint: "#1a2e4a",
  },
};

/** Bounds for the surface-contrast multiplier (1 = the built-in steps). */
export const CONTRAST = { min: 0.25, max: 2, fallback: 1 } as const;

export function clampContrast(n: number): number {
  return Math.min(CONTRAST.max, Math.max(CONTRAST.min, n));
}

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
  if (isHexColor(m.canvas)) out.canvas = m.canvas.toLowerCase();
  if (isHexColor(m.surface)) out.surface = m.surface.toLowerCase();
  if (isHexColor(m.accent)) out.accent = m.accent.toLowerCase();
  if (isHexColor(m.tint)) out.tint = m.tint.toLowerCase();
  if (typeof m.contrast === "number" && Number.isFinite(m.contrast))
    out.contrast = clampContrast(m.contrast);
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

export function getStoredRadius(): number | null {
  const raw = localStorage.getItem(RADIUS_KEY);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? clampSize(n, RADIUS) : null;
}

export function storeRadius(v: number | null): void {
  if (v === null) localStorage.removeItem(RADIUS_KEY);
  else localStorage.setItem(RADIUS_KEY, String(clampSize(v, RADIUS)));
}

/**
 * The chat column max-width in px, or `null` when the cap is off (full width).
 * Default (nothing stored) is `CHAT_WIDTH.fallback` (cap on). The literal
 * `"off"` is the explicit opt-out; any stored number is clamped to CHAT_WIDTH.
 */
export function getStoredChatMaxWidth(): number | null {
  const raw = localStorage.getItem(CHAT_WIDTH_KEY);
  if (raw === null) return CHAT_WIDTH.fallback;
  if (raw === "off") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? clampSize(n, CHAT_WIDTH) : CHAT_WIDTH.fallback;
}

/**
 * Persist the chat max-width: `null` writes the `"off"` opt-out; the default
 * width removes the key (absence = default-on); any other value is clamped and
 * stored as a number string.
 */
export function storeChatMaxWidth(v: number | null): void {
  if (v === null) {
    localStorage.setItem(CHAT_WIDTH_KEY, "off");
    return;
  }
  const clamped = clampSize(v, CHAT_WIDTH);
  if (clamped === CHAT_WIDTH.fallback) localStorage.removeItem(CHAT_WIDTH_KEY);
  else localStorage.setItem(CHAT_WIDTH_KEY, String(clamped));
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
 *
 * `surface` replaces the default black/white pole with a custom mix color
 * (tinted surfaces); `contrast` scales the tone steps (1 = built-in).
 */
export function derivedSurfaceDecls(
  background: string,
  surface?: string,
  contrast = 1,
): string[] {
  const pole =
    surface ??
    (contrastForeground(background) === "#ffffff" ? "#ffffff" : "#000000");
  const c = clampContrast(contrast);
  const tone = (t: number) => mixHex(background, pole, Math.min(1, t * c));
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

/** How far a custom mix color bleeds into the main background itself. */
const BACKGROUND_TINT = 0.05;

/**
 * The effective main background: the raw pick, or — when a mix color is set —
 * the pick slightly blended toward it (scaled by the contrast multiplier) so
 * the whole canvas carries the tint, not just the derived surfaces.
 */
export function tintedBackground(
  background: string,
  surface?: string,
  contrast = 1,
): string {
  if (!surface) return background;
  return mixHex(
    background,
    surface,
    Math.min(1, BACKGROUND_TINT * clampContrast(contrast)),
  );
}

function colorDecls(mc: ModeColors): string[] {
  const d: string[] = [];
  if (mc.primary) {
    d.push(`--primary: ${mc.primary};`);
    d.push(`--primary-foreground: ${contrastForeground(mc.primary)};`);
  }
  if (mc.accent) {
    d.push(`--accent: ${mc.accent};`);
    d.push(`--accent-foreground: ${contrastForeground(mc.accent)};`);
  }
  if (mc.tint) {
    d.push(`--tint: ${mc.tint};`);
  }
  if (mc.canvas) {
    d.push(`--canvas: ${mc.canvas};`);
  }
  if (mc.background) {
    const bg = tintedBackground(mc.background, mc.surface, mc.contrast);
    d.push(`--background: ${bg};`);
    d.push(`--foreground: ${contrastForeground(bg)};`);
    d.push(...derivedSurfaceDecls(bg, mc.surface, mc.contrast));
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

/** Inject (or replace) CSS in a `<style id=…>`; empty CSS removes it. */
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

/**
 * Corner radius: every `rounded-*` utility derives from the `--radius` token
 * (the `--radius-sm…4xl` sizes are calc() multiples of it), so one override
 * re-rounds the whole UI — cards, buttons, inputs, popovers.
 */
export function buildRadiusCss(v: number | null): string {
  return v === null ? "" : `:root { --radius: ${clampSize(v, RADIUS)}px; }`;
}

export function applyCustomRadius(v: number | null): void {
  injectStyle(RADIUS_STYLE_ID, buildRadiusCss(v));
}
