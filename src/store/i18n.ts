import { useMemo } from "react";
import { create } from "zustand";
import {
  en,
  matchLocale,
  translate,
  translatePlural,
  type LanguagePack,
  type MessageKey,
  type MessageParams,
  type PluralBase,
} from "@/lib/i18n";
import { listLanguages } from "@/lib/languages";
import type { RelativeTimeLabels } from "@/lib/time";

// Bundled language packs (T32). `en.json` is a thin pack (`strings: {}`) —
// English always resolves from the TS catalog in `src/lib/i18n.ts`, so the two
// can't drift; the JSON file exists so "English" appears in the selector like
// any other pack. The other five carry full translations.
import enPack from "@/locales/en.json";
import dePack from "@/locales/de.json";
import frPack from "@/locales/fr.json";
import plPack from "@/locales/pl.json";
import esPack from "@/locales/es.json";
import daPack from "@/locales/da.json";

export const BUNDLED_PACKS: LanguagePack[] = [
  enPack,
  dePack,
  frPack,
  plPack,
  esPack,
  daPack,
];

/** localStorage key for the selected locale (synchronous at startup — no
 *  flash, mirroring the theme preference; deliberately not the SQLite
 *  `settings` table). */
const LOCALE_STORAGE_KEY = "locale";

function getStoredLocale(): string | null {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeLocale(code: string): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, code);
  } catch {
    // localStorage unavailable — selection just won't persist.
  }
}

/**
 * The display list: bundled packs plus user packs, one entry per code. A user
 * pack with a bundled code overrides the entry's display name, and its strings
 * are *merged on top of* the bundled ones (per-key), so a partial user `de`
 * pack refines the bundled German instead of replacing it.
 */
export function mergePacks(
  bundled: LanguagePack[],
  user: LanguagePack[],
): LanguagePack[] {
  const byCode = new Map<string, LanguagePack>();
  for (const p of bundled) byCode.set(p.code, p);
  for (const p of user) {
    const base = byCode.get(p.code);
    byCode.set(
      p.code,
      base ? { ...p, strings: { ...base.strings, ...p.strings } } : p,
    );
  }
  return Array.from(byCode.values());
}

/** Active strings for a locale within a merged pack list (empty = English). */
function stringsFor(
  packs: LanguagePack[],
  locale: string,
): Record<string, string> {
  return packs.find((p) => p.code === locale)?.strings ?? {};
}

/** Default locale: stored pick, else the system locale when a bundled pack
 *  matches (primary-subtag match, e.g. "de-AT" → "de"), else English. */
function initialLocale(): string {
  return (
    getStoredLocale() ??
    matchLocale(
      navigator.language,
      BUNDLED_PACKS.map((p) => p.code),
    ) ??
    "en"
  );
}

interface I18nState {
  /** Active locale code (a pack code; "en" = the built-in catalog). */
  locale: string;
  /** Bundled + user packs, merged by code (user strings override per-key). */
  packs: LanguagePack[];
  /** The active pack's strings (lookups fall back to the English catalog). */
  strings: Record<string, string>;
  /** Whether `loadUserPacks` has completed at least once. */
  loaded: boolean;
  error: string | null;

  /** Select + persist a locale; applies live (subscribers re-render). */
  setLocale: (code: string) => void;
  /** Discover user packs from the app-data languages folder (Rust). */
  loadUserPacks: () => Promise<void>;
}

export const useI18n = create<I18nState>((set, get) => ({
  locale: initialLocale(),
  packs: BUNDLED_PACKS,
  strings: stringsFor(BUNDLED_PACKS, initialLocale()),
  loaded: false,
  error: null,

  setLocale: (code) => {
    storeLocale(code);
    set({ locale: code, strings: stringsFor(get().packs, code) });
  },

  loadUserPacks: async () => {
    try {
      const user = await listLanguages();
      const packs = mergePacks(BUNDLED_PACKS, user);
      // The saved locale may reference a pack that was since removed; fall
      // back to English in that case (the strings already resolve to {}).
      set({
        packs,
        strings: stringsFor(packs, get().locale),
        loaded: true,
        error: null,
      });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loaded: true });
    }
  },
}));

/**
 * Imperative translate — for event handlers, stores, and other non-render
 * call sites (`confirmDialog({ title: t("…") })`). Render paths should use
 * `useT()` so a locale switch re-renders them live.
 */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(useI18n.getState().strings, key, params);
}

/** Imperative plural translate (`Intl.PluralRules` against the active locale). */
export function tp(
  base: PluralBase,
  n: number,
  params?: MessageParams,
): string {
  const { strings, locale } = useI18n.getState();
  return translatePlural(strings, locale, base, n, params);
}

/**
 * Hook returning a `t` bound to the live catalog. Subscribing to `strings`
 * makes every consumer re-render when the locale changes — this is what makes
 * language switching apply live, without a reload.
 */
export function useT(): (key: MessageKey, params?: MessageParams) => string {
  const strings = useI18n((s) => s.strings);
  return useMemo(
    () => (key: MessageKey, params?: MessageParams) =>
      translate(strings, key, params),
    [strings],
  );
}

/** Hook variant of `tp`, live like `useT`. */
export function useTp(): (
  base: PluralBase,
  n: number,
  params?: MessageParams,
) => string {
  const strings = useI18n((s) => s.strings);
  const locale = useI18n((s) => s.locale);
  return useMemo(
    () => (base: PluralBase, n: number, params?: MessageParams) =>
      translatePlural(strings, locale, base, n, params),
    [strings, locale],
  );
}

/**
 * The locale to hand to `Intl` formatters. When the active pack's primary
 * subtag matches the system locale's, prefer the *system* locale so regional
 * conventions are kept (e.g. active "en" + system "en-GB" → day/month order).
 */
export function intlLocale(): string {
  const { locale } = useI18n.getState();
  const sys = navigator.language;
  if (sys && sys.split("-")[0].toLowerCase() === locale.toLowerCase())
    return sys;
  return locale;
}

/** Hook: the active `Intl` locale, re-evaluated when the locale changes. */
export function useIntlLocale(): string {
  const locale = useI18n((s) => s.locale);
  const sys = navigator.language;
  if (sys && sys.split("-")[0].toLowerCase() === locale.toLowerCase())
    return sys;
  return locale;
}

/** Relative-time templates for `src/lib/time.ts`, from the active catalog. */
export function timeLabels(): RelativeTimeLabels {
  return {
    justNow: t("time.justNow"),
    minutes: t("time.minutesAgo"),
    hours: t("time.hoursAgo"),
    days: t("time.daysAgo"),
  };
}

// Re-export the catalog type for convenience at call sites that build typed
// key maps (e.g. `Record<ChatStyle, MessageKey>`).
export type { MessageKey };
export { en };
