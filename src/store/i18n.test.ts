// i18n store behavior (T32): pack merging, live locale switching, fallback.

import { beforeEach, describe, expect, it } from "vitest";
import { BUNDLED_PACKS, mergePacks, t, tp, useI18n } from "@/store/i18n";

beforeEach(() => {
  localStorage.clear();
  useI18n.setState({
    locale: "en",
    packs: BUNDLED_PACKS,
    strings: {},
  });
});

describe("mergePacks", () => {
  it("appends user packs with new codes", () => {
    const merged = mergePacks(BUNDLED_PACKS, [
      { name: "Svenska", code: "sv", strings: { "common.save": "Spara" } },
    ]);
    expect(merged.map((p) => p.code)).toContain("sv");
    expect(merged.length).toBe(BUNDLED_PACKS.length + 1);
  });

  it("merges a user pack's strings on top of a bundled one (per-key)", () => {
    const merged = mergePacks(BUNDLED_PACKS, [
      { name: "Deutsch (eigen)", code: "de", strings: { "common.save": "X" } },
    ]);
    const de = merged.find((p) => p.code === "de")!;
    expect(de.name).toBe("Deutsch (eigen)"); // user display name wins
    expect(de.strings["common.save"]).toBe("X"); // user override
    expect(de.strings["common.cancel"]).toBe("Abbrechen"); // bundled kept
    expect(merged.length).toBe(BUNDLED_PACKS.length);
  });
});

describe("setLocale / t / tp", () => {
  it("switches the active strings live and persists the pick", () => {
    expect(t("common.save")).toBe("Save");
    useI18n.getState().setLocale("de");
    expect(t("common.save")).toBe("Speichern");
    expect(localStorage.getItem("locale")).toBe("de");
  });

  it("falls back to English for keys a pack does not translate", () => {
    useI18n.setState({ locale: "xx", strings: { "common.save": "Zzz" } });
    expect(t("common.save")).toBe("Zzz");
    expect(t("common.cancel")).toBe("Cancel");
  });

  it("tp pluralizes with the active locale's rules", () => {
    useI18n.getState().setLocale("pl");
    expect(tp("search.matches", 5)).toBe("5 dopasowań");
    useI18n.getState().setLocale("en");
    expect(tp("search.matches", 5)).toBe("5 matches");
  });

  it("interpolates params", () => {
    useI18n.getState().setLocale("fr");
    expect(t("common.byAuthor", { author: "Ada" })).toBe("par Ada");
  });
});
