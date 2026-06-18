import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { NativeSelect } from "@/components/NativeSelect";
import { useTitleBar } from "@/store/titlebar";
import { useTheme } from "@/store/theme";
import { useAppearance } from "@/store/appearance";
import { useT, type MessageKey } from "@/store/i18n";
import { resolveTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
  CHAT_CONTAINER_CLASSES,
  CHAT_LIST_STYLES,
  CHAT_SIZE,
  CHAT_STYLES,
  CHAT_WIDTH,
  CONTRAST,
  DEFAULT_PICKER_COLORS,
  DENSITY_LABELS,
  FONT_OPTIONS,
  RADIUS,
  styleClasses,
  UI_SIZE,
  type ChatListStyle,
  type ChatStyle,
  type Density,
  type SizeRange,
} from "@/lib/appearance";
import {
  isMac,
  type ControlsSide,
  type ControlsStyle,
  type MenuBarMode,
  type TitleBarMode,
} from "@/lib/titlebar";

/**
 * Appearance settings section: title bar customization (native vs. custom
 * chrome, window-control side and style), custom Colors (T30) and Typography
 * (T33) cards, plus the chat message layout (T34) and sidebar chat-list row
 * (T35) styles.
 */
export function Appearance() {
  return (
    <div className="flex flex-col gap-5">
      <ThemeCard />
      <TitleBarCard />
      <ColorsCard />
      <CornersCard />
      <DensityCard />
      <AnimationsCard />
      <TypographyCard />
      <ChatStyleCard />
      <ChatWidthCard />
      <ChatListCard />
    </div>
  );
}

/** i18n keys for the T34 chat-style labels (values stay in lib/appearance). */
const CHAT_STYLE_KEYS: Record<ChatStyle, MessageKey> = {
  default: "chatStyle.default",
  bubbles: "chatStyle.bubbles",
  compact: "chatStyle.compact",
  document: "chatStyle.document",
  cards: "chatStyle.cards",
  cozy: "chatStyle.cozy",
  terminal: "chatStyle.terminal",
  zebra: "chatStyle.zebra",
};

/**
 * Small sample conversation rendered with the selected layout, using the real
 * per-style classes from `MessageList` (`styleClasses` and
 * `CHAT_CONTAINER_CLASSES`) so the preview can't drift from the actual chat —
 * only the text size is scaled down to fit.
 */
function ChatStylePreview({ style }: { style: ChatStyle }) {
  const t = useT();
  const sample: { isUser: boolean; text: string }[] = [
    { isUser: true, text: t("chatStyle.mockUser1") },
    { isUser: false, text: t("chatStyle.mockAssistant") },
    { isUser: true, text: t("chatStyle.mockUser2") },
  ];

  return (
    <div
      aria-hidden
      className={cn(
        "bg-background pointer-events-none flex flex-col rounded-md border select-none",
        // Style hook for the T34 rules in index.css, mirroring MessageList.
        `chat-style-${style}`,
        CHAT_CONTAINER_CLASSES[style],
      )}
    >
      {sample.map((m, i) => {
        const roleLabel = m.isUser ? t("chat.you") : t("chat.ai");
        if (style === "compact") {
          // Mirrors MessageList's dense gutter markup at preview scale.
          return (
            <div key={i} className="flex w-full gap-2 text-xs">
              <span
                className={cn(
                  "w-8 shrink-0 text-right text-[10px] leading-4 font-semibold",
                  m.isUser ? "text-primary" : "text-muted-foreground",
                )}
              >
                {roleLabel}
              </span>
              <span className="min-w-0 flex-1">{m.text}</span>
            </div>
          );
        }
        if (style === "cozy") {
          // Mirrors the avatar-and-name markup at preview scale.
          return (
            <div key={i} className="flex gap-2">
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full text-[9px] font-bold uppercase",
                  m.isUser
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {roleLabel.slice(0, 1)}
              </span>
              <div className="flex min-w-0 flex-1 flex-col text-xs">
                <span
                  className={cn(
                    "text-[10px] leading-5 font-semibold capitalize",
                    m.isUser ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {roleLabel}
                </span>
                <span>{m.text}</span>
              </div>
            </div>
          );
        }
        if (style === "terminal") {
          // Mirrors the prompt-prefixed mono markup at preview scale.
          return (
            <div
              key={i}
              className={cn(
                "flex w-full gap-2 font-mono text-xs",
                m.isUser && "text-primary",
              )}
            >
              {m.isUser && <span className="shrink-0 font-bold">❯</span>}
              <span className="min-w-0 flex-1">{m.text}</span>
            </div>
          );
        }
        const { row, content } = styleClasses(style, m.isUser);
        return (
          <div key={i} className={cn("flex", row)}>
            <div className={cn(content, "text-xs")}>{m.text}</div>
          </div>
        );
      })}
    </div>
  );
}

/** How chat messages render (T34): the original flat layout, messenger-style
 *  bubbles, a dense IRC-like view, or a document/reading mode. */
function ChatStyleCard() {
  const t = useT();
  const chatStyle = useAppearance((s) => s.chatStyle);
  const setChatStyle = useAppearance((s) => s.setChatStyle);

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t("chatStyle.title")}</CardTitle>
        <CardDescription>{t("chatStyle.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t("chatStyle.layout")}</span>
          {/* Spaced chips (not a joined segment) so eight options wrap cleanly. */}
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={chatStyle}
            onValueChange={(v) => v && setChatStyle(v as ChatStyle)}
            className="w-full flex-wrap"
          >
            {CHAT_STYLES.map((s) => (
              <ToggleGroupItem key={s.value} value={s.value}>
                {t(CHAT_STYLE_KEYS[s.value])}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs font-medium">
            {t("chatStyle.preview")}
          </span>
          <ChatStylePreview style={chatStyle} />
        </div>
      </CardContent>
    </Card>
  );
}

/** Chat column max-width (T-chat-width): an on/off cap plus a width slider.
 *  Off = full width; on = centered column at the chosen px on wide windows. */
function ChatWidthCard() {
  const t = useT();
  const chatMaxWidth = useAppearance((s) => s.chatMaxWidth);
  const setChatMaxWidth = useAppearance((s) => s.setChatMaxWidth);
  const on = chatMaxWidth !== null;
  const width = chatMaxWidth ?? CHAT_WIDTH.fallback;

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t("chatWidth.title")}</CardTitle>
        <CardDescription>{t("chatWidth.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <OptionRow label={t("chatWidth.label")}>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={on ? "on" : "off"}
            onValueChange={(v) =>
              v && setChatMaxWidth(v === "on" ? width : null)
            }
          >
            <ToggleGroupItem value="on">{t("common.on")}</ToggleGroupItem>
            <ToggleGroupItem value="off">{t("common.off")}</ToggleGroupItem>
          </ToggleGroup>
        </OptionRow>
        {on && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">
              {t("chatWidth.maxWidth")}
            </span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={CHAT_WIDTH.min}
                max={CHAT_WIDTH.max}
                step={20}
                value={width}
                aria-label={t("chatWidth.maxWidth")}
                onChange={(e) => setChatMaxWidth(Number(e.target.value))}
                className="accent-primary w-36"
              />
              <span className="text-muted-foreground w-14 text-right text-xs tabular-nums">
                {width}px
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={width === CHAT_WIDTH.fallback}
                onClick={() => setChatMaxWidth(CHAT_WIDTH.fallback)}
              >
                {t("common.reset")}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** i18n keys for the T35 chat-list row-style labels. */
const CHAT_LIST_KEYS: Record<ChatListStyle, MessageKey> = {
  title: "chatList.titleOption",
  "title-date": "chatList.titleDate",
  detailed: "chatList.detailed",
  preview: "chatList.preview",
  inline: "chatList.inline",
  icon: "chatList.icon",
  compact: "chatList.compact",
  full: "chatList.full",
};

/** Tiny static mock of one sidebar row, per chat-list style (T35). */
function ChatListRowMock({ style }: { style: ChatListStyle }) {
  const t = useT();
  const mockDate = t("time.hoursAgo", { n: 2 });
  const trailingDate = style === "inline" || style === "full";
  return (
    <span
      className={cn(
        "bg-background flex w-full min-w-0 flex-col rounded-md border px-2 text-left",
        style === "compact" ? "py-0.5" : "py-1.5",
      )}
    >
      <span className="flex w-full min-w-0 items-center gap-1.5">
        {style === "icon" && (
          <span className="bg-primary/10 text-primary grid size-4 shrink-0 place-items-center rounded-full text-[8px] font-bold">
            A
          </span>
        )}
        <span
          className={cn(
            "truncate font-medium",
            style === "compact" ? "text-[10px]" : "text-xs",
          )}
        >
          {t("chatList.mockTitle")}
        </span>
        {trailingDate && (
          <span className="text-muted-foreground ml-auto shrink-0 pl-1 text-[9px] tabular-nums">
            {mockDate}
          </span>
        )}
      </span>
      {style === "title-date" && (
        <span className="text-muted-foreground truncate text-[10px]">
          {mockDate}
        </span>
      )}
      {style === "detailed" && (
        <span className="text-muted-foreground truncate text-[10px]">
          {mockDate} · Anthropic · Opus 4.8
        </span>
      )}
      {(style === "preview" || style === "full") && (
        <span className="text-muted-foreground truncate text-[10px]">
          {t("chatList.mockPreview")}
        </span>
      )}
    </span>
  );
}

/** What a sidebar thread row shows (T35), picked from inline previews. */
function ChatListCard() {
  const t = useT();
  const listStyle = useAppearance((s) => s.chatListStyle);
  const setListStyle = useAppearance((s) => s.setChatListStyle);

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t("chatList.title")}</CardTitle>
        <CardDescription>{t("chatList.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2">
          {CHAT_LIST_STYLES.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={listStyle === o.value}
              onClick={() => setListStyle(o.value)}
              className={cn(
                "flex flex-col gap-1.5 rounded-lg border p-2 text-left",
                listStyle === o.value
                  ? "border-primary ring-primary/30 ring-2"
                  : "hover:bg-muted/50",
              )}
            >
              <ChatListRowMock style={o.value} />
              <span className="text-xs font-medium">
                {t(CHAT_LIST_KEYS[o.value])}
              </span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Custom accent/background color picks (T30). Picks are per-mode: editing
 * happens against whichever of light/dark is currently active, and the
 * overrides are scoped so each mode keeps its own picks (by selector
 * specificity — see `lib/appearance.ts`).
 */
function ColorsCard() {
  const t = useT();
  const theme = useTheme((s) => s.theme);
  const mode = resolveTheme(theme);
  const colors = useAppearance((s) => s.colors);
  const setColor = useAppearance((s) => s.setColor);
  const resetColor = useAppearance((s) => s.resetColor);
  const setContrast = useAppearance((s) => s.setContrast);
  const resetAllColors = useAppearance((s) => s.resetAllColors);
  const picks = colors[mode];
  const hasBackground = picks.background !== undefined;
  const anyPick =
    Object.keys(colors.light).length > 0 || Object.keys(colors.dark).length > 0;

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t("colors.title")}</CardTitle>
        <CardDescription>
          {t("colors.description", {
            mode: mode === "dark" ? t("colors.dark") : t("colors.light"),
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ColorRow
          label={t("colors.accent")}
          value={picks.primary ?? DEFAULT_PICKER_COLORS[mode].primary}
          custom={picks.primary !== undefined}
          onChange={(hex) => setColor(mode, "primary", hex)}
          onReset={() => resetColor(mode, "primary")}
        />
        <ColorRow
          label={t("colors.background")}
          value={picks.background ?? DEFAULT_PICKER_COLORS[mode].background}
          custom={picks.background !== undefined}
          onChange={(hex) => setColor(mode, "background", hex)}
          onReset={() => resetColor(mode, "background")}
        />
        <ColorRow
          label={t("colors.mixColor")}
          value={picks.surface ?? DEFAULT_PICKER_COLORS[mode].surface}
          custom={picks.surface !== undefined}
          disabled={!hasBackground}
          onChange={(hex) => setColor(mode, "surface", hex)}
          onReset={() => resetColor(mode, "surface")}
        />
        <div className="flex items-center justify-between gap-3">
          <span
            className={cn(
              "text-sm font-medium",
              !hasBackground && "text-muted-foreground",
            )}
          >
            {t("colors.contrast")}
          </span>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={CONTRAST.min}
              max={CONTRAST.max}
              step={0.05}
              disabled={!hasBackground}
              value={picks.contrast ?? CONTRAST.fallback}
              aria-label={t("colors.contrast")}
              onChange={(e) => setContrast(mode, Number(e.target.value))}
              className="accent-primary w-36 disabled:opacity-50"
            />
            <span className="text-muted-foreground w-12 text-right text-xs tabular-nums">
              ×{(picks.contrast ?? CONTRAST.fallback).toFixed(2)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={picks.contrast === undefined}
              onClick={() => setContrast(mode, null)}
            >
              {t("common.reset")}
            </Button>
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={!anyPick}
            onClick={resetAllColors}
          >
            {t("colors.resetAll")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ColorRow({
  label,
  value,
  custom,
  disabled = false,
  onChange,
  onReset,
}: {
  label: string;
  /** Current hex shown by the picker (the default seed when not custom). */
  value: string;
  /** Whether a custom pick is stored (enables Reset). */
  custom: boolean;
  /** Grays the row out (e.g. mix color without a background pick). */
  disabled?: boolean;
  onChange: (hex: string) => void;
  onReset: () => void;
}) {
  const t = useT();
  return (
    <div className="flex items-center justify-between gap-3">
      <span
        className={cn(
          "text-sm font-medium",
          disabled && "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          disabled={disabled}
          aria-label={t("colors.colorAria", { label })}
          onChange={(e) => onChange(e.target.value)}
          className="border-input h-8 w-12 cursor-pointer rounded-md border bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || !custom}
          onClick={onReset}
        >
          {t("common.reset")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Corner roundness: one slider driving the `--radius` token that every
 * rounded-* size is a calc() multiple of, so cards, buttons, inputs, and
 * popovers re-round together (0 = sharp).
 */
function CornersCard() {
  const t = useT();
  const radius = useAppearance((s) => s.radius);
  const setRadius = useAppearance((s) => s.setRadius);

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t("corners.title")}</CardTitle>
        <CardDescription>{t("corners.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <SizeRow
          label={t("corners.label")}
          value={radius}
          range={RADIUS}
          onChange={setRadius}
        />
      </CardContent>
    </Card>
  );
}

/** Global on/off for UI animations and transitions (T46). */
function AnimationsCard() {
  const t = useT();
  const animations = useAppearance((s) => s.animations);
  const setAnimations = useAppearance((s) => s.setAnimations);

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t("animations.title")}</CardTitle>
        <CardDescription>{t("animations.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <OptionRow label={t("animations.label")}>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={animations ? "on" : "off"}
            onValueChange={(v) => v && setAnimations(v === "on")}
          >
            <ToggleGroupItem value="on">{t("common.on")}</ToggleGroupItem>
            <ToggleGroupItem value="off">{t("common.off")}</ToggleGroupItem>
          </ToggleGroup>
        </OptionRow>
      </CardContent>
    </Card>
  );
}

/** UI density: compact, default, or comfortable. Drives the --density-scale
 *  CSS variable that components reference for spacing/padding. */
function DensityCard() {
  const t = useT();
  const density = useAppearance((s) => s.density);
  const setDensity = useAppearance((s) => s.setDensity);

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t("density.title")}</CardTitle>
        <CardDescription>{t("density.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <OptionRow label={t("density.label")}>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={String(density)}
            onValueChange={(v) => v && setDensity(Number(v) as Density)}
          >
            <ToggleGroupItem value="0">{DENSITY_LABELS[0]}</ToggleGroupItem>
            <ToggleGroupItem value="1">{DENSITY_LABELS[1]}</ToggleGroupItem>
            <ToggleGroupItem value="2">{DENSITY_LABELS[2]}</ToggleGroupItem>
          </ToggleGroup>
        </OptionRow>
      </CardContent>
    </Card>
  );
}

/**
 * Font family + size for the app UI and for chat message content (T33).
 * Families come from a curated list (plus a free-text escape hatch); sizes are
 * px sliders. UI size scales the root font-size (everything rem-based follows);
 * chat settings only affect message content via `.chat-content`.
 */
function TypographyCard() {
  const t = useT();
  const typography = useAppearance((s) => s.typography);
  const setTypography = useAppearance((s) => s.setTypography);

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t("typography.title")}</CardTitle>
        <CardDescription>{t("typography.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FontRow
          label={t("typography.uiFont")}
          value={typography.uiFont}
          onChange={(v) => setTypography({ uiFont: v })}
        />
        <FontRow
          label={t("typography.chatFont")}
          value={typography.chatFont}
          onChange={(v) => setTypography({ chatFont: v })}
        />
        <SizeRow
          label={t("typography.uiSize")}
          value={typography.uiSize}
          range={UI_SIZE}
          onChange={(v) => setTypography({ uiSize: v })}
        />
        <SizeRow
          label={t("typography.chatSize")}
          value={typography.chatSize}
          range={CHAT_SIZE}
          onChange={(v) => setTypography({ chatSize: v })}
        />
      </CardContent>
    </Card>
  );
}

const FONT_DEFAULT = "__default__";
const FONT_CUSTOM = "__custom__";

/** Curated entries whose display names are translatable (system stacks); the
 *  rest of `FONT_OPTIONS` are font names and stay as-is. */
const FONT_LABEL_KEYS: Record<string, MessageKey> = {
  "system-ui": "typography.systemDefault",
  serif: "typography.systemSerif",
  monospace: "typography.systemMonospace",
};

function FontRow({
  label,
  value,
  onChange,
}: {
  label: string;
  /** Stored family string, or null for the bundled default (Geist). */
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const t = useT();
  // "Custom…" stays selected while the free-text input is open, even when the
  // typed value happens to match a curated one.
  const [customOpen, setCustomOpen] = useState(false);
  const isCurated =
    value === null || FONT_OPTIONS.some((o) => o.value === value);
  const showCustom = customOpen || !isCurated;
  const selectValue = showCustom
    ? FONT_CUSTOM
    : value === null
      ? FONT_DEFAULT
      : value;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex items-center gap-2">
          <NativeSelect
            value={selectValue}
            aria-label={t("typography.familyAria", { label })}
            onChange={(e) => {
              const v = e.target.value;
              if (v === FONT_CUSTOM) {
                setCustomOpen(true);
                return;
              }
              setCustomOpen(false);
              onChange(v === FONT_DEFAULT ? null : v);
            }}
            className="h-8 w-44"
          >
            <option value={FONT_DEFAULT}>{t("typography.default")}</option>
            {FONT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {FONT_LABEL_KEYS[o.value]
                  ? t(FONT_LABEL_KEYS[o.value])
                  : o.label}
              </option>
            ))}
            <option value={FONT_CUSTOM}>{t("typography.custom")}</option>
          </NativeSelect>
          <Button
            variant="ghost"
            size="sm"
            disabled={value === null}
            onClick={() => {
              setCustomOpen(false);
              onChange(null);
            }}
          >
            {t("common.reset")}
          </Button>
        </div>
      </div>
      {showCustom && (
        <Input
          value={value ?? ""}
          placeholder={t("typography.customPlaceholder")}
          aria-label={t("typography.customFamilyAria", { label })}
          onChange={(e) => onChange(e.target.value || null)}
          className="h-8"
        />
      )}
    </div>
  );
}

function SizeRow({
  label,
  value,
  range,
  onChange,
}: {
  label: string;
  /** Stored px size, or null for the default. */
  value: number | null;
  range: SizeRange;
  onChange: (v: number | null) => void;
}) {
  const t = useT();
  const current = value ?? range.fallback;
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={1}
          value={current}
          aria-label={t("typography.sizeAria", { label })}
          onChange={(e) => onChange(Number(e.target.value))}
          className="accent-primary w-36"
        />
        <span className="text-muted-foreground w-12 text-right text-xs tabular-nums">
          {current}px
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={value === null}
          onClick={() => onChange(null)}
        >
          {t("common.reset")}
        </Button>
      </div>
    </div>
  );
}

/** Light / dark / system theme (moved here from the title-bar menu). */
function ThemeCard() {
  const t = useT();
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t("appearance.theme.title")}</CardTitle>
        <CardDescription>{t("appearance.theme.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <OptionRow label={t("appearance.theme.title")}>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={theme}
            onValueChange={(v) => v && setTheme(v as Theme)}
          >
            <ToggleGroupItem value="system">
              {t("appearance.theme.system")}
            </ToggleGroupItem>
            <ToggleGroupItem value="light">
              {t("appearance.theme.light")}
            </ToggleGroupItem>
            <ToggleGroupItem value="dark">
              {t("appearance.theme.dark")}
            </ToggleGroupItem>
          </ToggleGroup>
        </OptionRow>
      </CardContent>
    </Card>
  );
}

function TitleBarCard() {
  const t = useT();
  const mode = useTitleBar((s) => s.mode);
  const side = useTitleBar((s) => s.side);
  const style = useTitleBar((s) => s.style);
  const menuBar = useTitleBar((s) => s.menuBar);
  const setMode = useTitleBar((s) => s.setMode);
  const setSide = useTitleBar((s) => s.setSide);
  const setStyle = useTitleBar((s) => s.setStyle);
  const setMenuBar = useTitleBar((s) => s.setMenuBar);

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t("appearance.titleBar.title")}</CardTitle>
        <CardDescription>
          {t("appearance.titleBar.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <OptionRow label={t("appearance.titleBar.label")}>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={mode}
            onValueChange={(v) => v && setMode(v as TitleBarMode)}
          >
            <ToggleGroupItem value="custom">
              {t("appearance.titleBar.custom")}
            </ToggleGroupItem>
            <ToggleGroupItem value="native">
              {t("appearance.titleBar.native")}
            </ToggleGroupItem>
          </ToggleGroup>
        </OptionRow>

        {mode === "custom" && (
          <>
            <OptionRow label={t("appearance.titleBar.controls")}>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={0}
                value={side}
                onValueChange={(v) => v && setSide(v as ControlsSide)}
              >
                <ToggleGroupItem value="left">
                  {t("appearance.titleBar.left")}
                </ToggleGroupItem>
                <ToggleGroupItem value="right">
                  {t("appearance.titleBar.right")}
                </ToggleGroupItem>
              </ToggleGroup>
            </OptionRow>

            <OptionRow label={t("appearance.titleBar.controlStyle")}>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={0}
                value={style}
                onValueChange={(v) => v && setStyle(v as ControlsStyle)}
              >
                {/* OS names are proper nouns — not translated. */}
                <ToggleGroupItem value="windows">Windows</ToggleGroupItem>
                <ToggleGroupItem value="macos">macOS</ToggleGroupItem>
                <ToggleGroupItem value="gnome">GNOME</ToggleGroupItem>
              </ToggleGroup>
            </OptionRow>
          </>
        )}

        {/* macOS always uses the system menu bar; placement only applies to
            the in-window menubar on Linux/Windows. */}
        {!isMac && (
          <div className="flex flex-col gap-1.5">
            <OptionRow label={t("appearance.menuBar.label")}>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={0}
                value={menuBar}
                onValueChange={(v) => v && setMenuBar(v as MenuBarMode)}
              >
                <ToggleGroupItem value="native">
                  {t("appearance.menuBar.native")}
                </ToggleGroupItem>
                <ToggleGroupItem value="inline">
                  {t("appearance.menuBar.inline")}
                </ToggleGroupItem>
                <ToggleGroupItem value="hidden">
                  {t("appearance.menuBar.hidden")}
                </ToggleGroupItem>
              </ToggleGroup>
            </OptionRow>
            <p className="text-muted-foreground text-xs">
              {t("appearance.menuBar.hint")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OptionRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}
