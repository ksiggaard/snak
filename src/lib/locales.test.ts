// Bundled language-pack integrity (T32). The TS catalog (`en` in lib/i18n) is
// the canonical key set; these tests keep the shipped JSON packs honest:
//
// - every pack validates against the pack schema;
// - de/fr/pl/es/da are **complete** (every catalog key is translated — the
//   English-fallback path is for user packs, not bundled ones);
// - packs contain no orphan keys (typos), except extra CLDR plural categories
//   (e.g. Polish `.few`/`.many`) whose `<base>.other` exists in the catalog.

import { describe, expect, it } from "vitest";
import { en, parseLanguagePack, type LanguagePack } from "@/lib/i18n";
import enPack from "@/locales/en.json";
import dePack from "@/locales/de.json";
import frPack from "@/locales/fr.json";
import plPack from "@/locales/pl.json";
import esPack from "@/locales/es.json";
import daPack from "@/locales/da.json";

const TRANSLATED: LanguagePack[] = [dePack, frPack, plPack, esPack, daPack];
const ALL: LanguagePack[] = [enPack, ...TRANSLATED];

const catalogKeys = new Set(Object.keys(en));

/** Allowed pack-only keys: extra plural categories of a known family. */
function isExtraPluralKey(key: string): boolean {
  const m = /^(.*)\.(zero|one|two|few|many)$/.exec(key);
  return m !== null && catalogKeys.has(`${m[1]}.other`);
}

describe("bundled language packs", () => {
  it("all validate as language packs", () => {
    for (const pack of ALL) {
      expect(parseLanguagePack(pack), pack.code).not.toBeNull();
    }
  });

  it("en is the thin pack (strings come from the TS catalog)", () => {
    expect(enPack.code).toBe("en");
    expect(Object.keys(enPack.strings)).toHaveLength(0);
  });

  it("translated packs cover every catalog key", () => {
    for (const pack of TRANSLATED) {
      const missing = [...catalogKeys].filter(
        (k) => !(k in pack.strings) || pack.strings[k as never] === "",
      );
      expect(missing, `${pack.code} is missing keys`).toEqual([]);
    }
  });

  it("translated packs contain no unknown keys (typo guard)", () => {
    for (const pack of TRANSLATED) {
      const unknown = Object.keys(pack.strings).filter(
        (k) => !catalogKeys.has(k) && !isExtraPluralKey(k),
      );
      expect(unknown, `${pack.code} has unknown keys`).toEqual([]);
    }
  });

  it("translated strings keep the catalog's {placeholders}", () => {
    const placeholders = (s: string) =>
      new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
    for (const pack of TRANSLATED) {
      for (const [key, value] of Object.entries(pack.strings)) {
        const enTemplate = (en as Record<string, string>)[key];
        if (!enTemplate) continue; // extra plural categories
        for (const p of placeholders(enTemplate)) {
          expect(
            placeholders(value).has(p),
            `${pack.code} ${key} is missing {${p}}`,
          ).toBe(true);
        }
      }
    }
  });

  it("codes are unique and names non-empty", () => {
    const codes = ALL.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const p of ALL) expect(p.name.trim().length).toBeGreaterThan(0);
  });
});
