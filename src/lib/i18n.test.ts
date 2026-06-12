import { describe, expect, it } from "vitest";
import {
  en,
  interpolate,
  isValidCode,
  matchLocale,
  parseLanguagePack,
  translate,
  translatePlural,
} from "@/lib/i18n";

describe("interpolate", () => {
  it("replaces {name} placeholders", () => {
    expect(interpolate("Hello {name}!", { name: "snak" })).toBe("Hello snak!");
  });

  it("replaces multiple and repeated placeholders", () => {
    expect(interpolate("{a} + {a} = {b}", { a: 1, b: 2 })).toBe("1 + 1 = 2");
  });

  it("leaves unknown placeholders intact", () => {
    expect(interpolate("Hi {who}", { name: "x" })).toBe("Hi {who}");
  });

  it("is a no-op without params", () => {
    expect(interpolate("Hi {who}")).toBe("Hi {who}");
  });
});

describe("translate", () => {
  it("prefers the active pack's string", () => {
    expect(translate({ "common.save": "Speichern" }, "common.save")).toBe(
      "Speichern",
    );
  });

  it("falls back to English for a missing key — never the raw key", () => {
    expect(translate({}, "common.save")).toBe("Save");
  });

  it("interpolates params in pack strings and fallbacks alike", () => {
    expect(
      translate({ "common.byAuthor": "von {author}" }, "common.byAuthor", {
        author: "Ada",
      }),
    ).toBe("von Ada");
    expect(translate({}, "common.byAuthor", { author: "Ada" })).toBe("by Ada");
  });
});

describe("translatePlural", () => {
  it("selects one/other for English", () => {
    expect(translatePlural({}, "en", "search.matches", 1)).toBe("1 match");
    expect(translatePlural({}, "en", "search.matches", 3)).toBe("3 matches");
  });

  it("uses CLDR categories the pack provides (Polish few/many)", () => {
    const pl = {
      "search.matches.one": "{n} dopasowanie",
      "search.matches.few": "{n} dopasowania",
      "search.matches.many": "{n} dopasowań",
      "search.matches.other": "{n} dopasowania",
    };
    expect(translatePlural(pl, "pl", "search.matches", 1)).toBe(
      "1 dopasowanie",
    );
    expect(translatePlural(pl, "pl", "search.matches", 3)).toBe(
      "3 dopasowania",
    );
    expect(translatePlural(pl, "pl", "search.matches", 5)).toBe("5 dopasowań");
    expect(translatePlural(pl, "pl", "search.matches", 22)).toBe(
      "22 dopasowania",
    );
  });

  it("falls back to the pack's .other before English", () => {
    const partial = { "search.matches.other": "{n} Treffer" };
    expect(translatePlural(partial, "de", "search.matches", 1)).toBe(
      "1 Treffer",
    );
    expect(translatePlural(partial, "de", "search.matches", 4)).toBe(
      "4 Treffer",
    );
  });

  it("tolerates an invalid locale", () => {
    expect(translatePlural({}, "not a locale", "search.matches", 2)).toBe(
      "2 matches",
    );
  });
});

describe("matchLocale", () => {
  const codes = ["en", "de", "fr", "pl", "es", "da"];

  it("matches exactly (case-insensitive)", () => {
    expect(matchLocale("de", codes)).toBe("de");
    expect(matchLocale("DA", codes)).toBe("da");
  });

  it("matches by primary subtag", () => {
    expect(matchLocale("de-AT", codes)).toBe("de");
    expect(matchLocale("es-419", codes)).toBe("es");
  });

  it("prefers an exact regional pack over the primary one", () => {
    expect(matchLocale("pt-BR", ["pt", "pt-BR"])).toBe("pt-BR");
  });

  it("returns null when nothing matches or input is missing", () => {
    expect(matchLocale("ja", codes)).toBeNull();
    expect(matchLocale(undefined, codes)).toBeNull();
  });
});

describe("parseLanguagePack", () => {
  it("accepts a valid pack", () => {
    const pack = parseLanguagePack({
      name: "Deutsch",
      code: "de",
      strings: { "common.save": "Speichern" },
    });
    expect(pack).toEqual({
      name: "Deutsch",
      code: "de",
      strings: { "common.save": "Speichern" },
    });
  });

  it("accepts an empty strings map", () => {
    expect(
      parseLanguagePack({ name: "English", code: "en", strings: {} }),
    ).not.toBeNull();
  });

  it("rejects non-objects, blank names, bad codes, non-string values", () => {
    expect(parseLanguagePack(null)).toBeNull();
    expect(parseLanguagePack("de")).toBeNull();
    expect(
      parseLanguagePack({ name: " ", code: "de", strings: {} }),
    ).toBeNull();
    expect(parseLanguagePack({ name: "X", code: "d", strings: {} })).toBeNull();
    expect(
      parseLanguagePack({ name: "X", code: "de_DE", strings: {} }),
    ).toBeNull();
    expect(
      parseLanguagePack({ name: "X", code: "de", strings: { a: 1 } }),
    ).toBeNull();
    expect(parseLanguagePack({ name: "X", code: "de" })).toBeNull();
  });
});

describe("isValidCode", () => {
  it("accepts plausible BCP 47 tags", () => {
    for (const c of ["en", "de", "pt-BR", "sr-Latn", "es-419"])
      expect(isValidCode(c), c).toBe(true);
  });
  it("rejects malformed tags", () => {
    for (const c of ["", "d", "de_DE", "de DE", "123", "-de"])
      expect(isValidCode(c), c).toBe(false);
  });
});

describe("en catalog", () => {
  it("every plural family has a .other form", () => {
    const keys = Object.keys(en);
    for (const key of keys) {
      const m = /^(.*)\.(one|few|many|other)$/.exec(key);
      if (m) expect(keys).toContain(`${m[1]}.other`);
    }
  });
});
