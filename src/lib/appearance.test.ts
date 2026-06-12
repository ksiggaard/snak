import { describe, it, expect, beforeEach } from "vitest";
import {
  applyCustomColors,
  applyCustomTypography,
  buildColorCss,
  buildTypographyCss,
  clampSize,
  contrastForeground,
  cssFontFamily,
  derivedSurfaceDecls,
  getStoredChatListStyle,
  getStoredChatStyle,
  getStoredCustomColors,
  getStoredTypography,
  isHexColor,
  mixHex,
  relativeLuminance,
  storeChatListStyle,
  storeChatStyle,
  storeCustomColors,
  storeTypography,
  tintedBackground,
  CHAT_SIZE,
  CONTRAST,
  UI_SIZE,
  type TypographyPrefs,
} from "@/lib/appearance";

const noTypography: TypographyPrefs = {
  uiFont: null,
  chatFont: null,
  uiSize: null,
  chatSize: null,
};

beforeEach(() => {
  localStorage.clear();
  document.getElementById("custom-colors")?.remove();
  document.getElementById("custom-typography")?.remove();
});

describe("isHexColor", () => {
  it("accepts #rrggbb only", () => {
    expect(isHexColor("#3b82f6")).toBe(true);
    expect(isHexColor("#ABCDEF")).toBe(true);
    expect(isHexColor("#fff")).toBe(false);
    expect(isHexColor("3b82f6")).toBe(false);
    expect(isHexColor("#3b82f6; }")).toBe(false);
    expect(isHexColor(42)).toBe(false);
  });
});

describe("relativeLuminance / contrastForeground", () => {
  it("computes luminance extremes", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });

  it("picks white text on dark accents", () => {
    expect(contrastForeground("#000000")).toBe("#ffffff");
    expect(contrastForeground("#1d4ed8")).toBe("#ffffff"); // blue-700
    expect(contrastForeground("#7f1d1d")).toBe("#ffffff"); // red-900
  });

  it("picks near-black text on light accents", () => {
    expect(contrastForeground("#ffffff")).toBe("#171717");
    expect(contrastForeground("#facc15")).toBe("#171717"); // yellow-400
    expect(contrastForeground("#a7f3d0")).toBe("#171717"); // emerald-200
  });
});

describe("buildColorCss", () => {
  it("returns empty CSS when nothing is picked", () => {
    expect(buildColorCss({ light: {}, dark: {} })).toBe("");
  });

  it("scopes light picks to :root:not(.dark) with computed foreground", () => {
    const css = buildColorCss({ light: { primary: "#1d4ed8" }, dark: {} });
    expect(css).toContain(":root:not(.dark), body:not(.dark)");
    expect(css).toContain("--primary: #1d4ed8;");
    expect(css).toContain("--primary-foreground: #ffffff;");
    expect(css).not.toContain(":root.dark");
  });

  it("scopes dark picks to :root.dark and emits background+foreground", () => {
    const css = buildColorCss({ light: {}, dark: { background: "#0b1220" } });
    expect(css).toContain(":root.dark, body.dark");
    expect(css).toContain("--background: #0b1220;");
    expect(css).toContain("--foreground: #ffffff;");
    expect(css).not.toContain(":not(.dark)");
  });

  it("emits both scopes independently", () => {
    const css = buildColorCss({
      light: { primary: "#facc15", background: "#ffffff" },
      dark: { primary: "#1d4ed8" },
    });
    expect(css).toContain(":root:not(.dark)");
    expect(css).toContain(":root.dark");
    expect(css).toContain("--primary-foreground: #171717;"); // on yellow
  });

  it("derives the surface family from a background pick only", () => {
    const accentOnly = buildColorCss({
      light: { primary: "#1d4ed8" },
      dark: {},
    });
    expect(accentOnly).not.toContain("--sidebar:");
    const css = buildColorCss({ light: { background: "#fdf6e3" }, dark: {} });
    for (const token of [
      "--sidebar:",
      "--sidebar-foreground:",
      "--sidebar-accent:",
      "--sidebar-border:",
      "--card:",
      "--popover:",
      "--muted:",
      "--secondary:",
      "--accent:",
      "--border:",
      "--input:",
      "--ring:",
    ])
      expect(css).toContain(token);
  });
});

describe("mixHex / derivedSurfaceDecls", () => {
  it("mixes channels linearly between the endpoints", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#ff0000", "#00ff00", 0.5)).toBe("#808000");
  });

  it("derives darker tones from a light background", () => {
    const decls = Object.fromEntries(
      derivedSurfaceDecls("#fdf6e3").map((d) => d.replace(";", "").split(": ")),
    );
    // every derived surface is darker than the light background pick
    for (const key of ["--sidebar", "--muted", "--border", "--card"])
      expect(relativeLuminance(decls[key])).toBeLessThan(
        relativeLuminance("#fdf6e3"),
      );
    // border carries more tone than the sidebar
    expect(relativeLuminance(decls["--border"])).toBeLessThan(
      relativeLuminance(decls["--sidebar"]),
    );
    expect(decls["--sidebar-foreground"]).toBe("#171717");
  });

  it("derives lighter tones from a dark background", () => {
    const decls = Object.fromEntries(
      derivedSurfaceDecls("#0b1220").map((d) => d.replace(";", "").split(": ")),
    );
    for (const key of ["--sidebar", "--muted", "--border", "--card"])
      expect(relativeLuminance(decls[key])).toBeGreaterThan(
        relativeLuminance("#0b1220"),
      );
    expect(decls["--sidebar-foreground"]).toBe("#ffffff");
  });

  it("keeps muted-foreground between foreground and background", () => {
    const decls = Object.fromEntries(
      derivedSurfaceDecls("#ffffff").map((d) => d.replace(";", "").split(": ")),
    );
    const l = relativeLuminance(decls["--muted-foreground"]);
    expect(l).toBeGreaterThan(relativeLuminance("#171717"));
    expect(l).toBeLessThan(relativeLuminance("#ffffff"));
  });

  it("scales tone steps with the contrast multiplier", () => {
    const at = (contrast: number) =>
      Object.fromEntries(
        derivedSurfaceDecls("#ffffff", undefined, contrast).map((d) =>
          d.replace(";", "").split(": "),
        ),
      );
    const low = at(0.5);
    const base = at(1);
    const high = at(2);
    expect(relativeLuminance(low["--sidebar"])).toBeGreaterThan(
      relativeLuminance(base["--sidebar"]),
    );
    expect(relativeLuminance(high["--sidebar"])).toBeLessThan(
      relativeLuminance(base["--sidebar"]),
    );
    // out-of-range multipliers clamp to CONTRAST bounds
    expect(derivedSurfaceDecls("#ffffff", undefined, 99)).toEqual(
      derivedSurfaceDecls("#ffffff", undefined, CONTRAST.max),
    );
  });

  it("mixes toward a custom surface pole instead of black/white", () => {
    const decls = Object.fromEntries(
      derivedSurfaceDecls("#ffffff", "#3b0764").map((d) =>
        d.replace(";", "").split(": "),
      ),
    );
    expect(decls["--sidebar"]).toBe(mixHex("#ffffff", "#3b0764", 0.1));
    expect(decls["--border"]).toBe(mixHex("#ffffff", "#3b0764", 0.18));
  });

  it("tints the main background toward the mix color, scaled by contrast", () => {
    expect(tintedBackground("#ffffff")).toBe("#ffffff");
    expect(tintedBackground("#ffffff", "#3b0764")).toBe(
      mixHex("#ffffff", "#3b0764", 0.05),
    );
    expect(tintedBackground("#ffffff", "#3b0764", 2)).toBe(
      mixHex("#ffffff", "#3b0764", 0.1),
    );
    // buildColorCss emits the tinted background, not the raw pick
    const css = buildColorCss({
      light: { background: "#ffffff", surface: "#3b0764" },
      dark: {},
    });
    expect(css).toContain(
      `--background: ${mixHex("#ffffff", "#3b0764", 0.05)};`,
    );
    expect(css).not.toContain("--background: #ffffff;");
  });
});

describe("cssFontFamily", () => {
  it("quotes names and appends a sans-serif fallback", () => {
    expect(cssFontFamily("Open Sans")).toBe('"Open Sans", sans-serif');
    expect(cssFontFamily("Inter")).toBe('"Inter", sans-serif');
  });

  it("keeps generic families unquoted without double fallback", () => {
    expect(cssFontFamily("system-ui")).toBe("system-ui");
    expect(cssFontFamily("Georgia, serif")).toBe('"Georgia", serif');
    expect(cssFontFamily("JetBrains Mono, monospace")).toBe(
      '"JetBrains Mono", monospace',
    );
  });

  it("strips CSS-breaking characters from free text", () => {
    expect(cssFontFamily('Evil"; } body { color: red')).toBe(
      '"Evil  body  color red", sans-serif',
    );
    expect(cssFontFamily("   ")).toBeNull();
    expect(cssFontFamily(";{}")).toBeNull();
  });
});

describe("buildTypographyCss", () => {
  it("returns empty CSS for all-default prefs", () => {
    expect(buildTypographyCss(noTypography)).toBe("");
  });

  it("emits --font-sans plus explicit html/body/utility rules for UI font", () => {
    const css = buildTypographyCss({ ...noTypography, uiFont: "Inter" });
    expect(css).toContain('--font-sans: "Inter", sans-serif;');
    expect(css).toContain(
      'html, body, .font-sans, .font-heading { font-family: "Inter", sans-serif; }',
    );
  });

  it("emits root font-size for UI size, clamped to bounds", () => {
    expect(buildTypographyCss({ ...noTypography, uiSize: 15 })).toContain(
      "html { font-size: 15px; }",
    );
    expect(buildTypographyCss({ ...noTypography, uiSize: 99 })).toContain(
      `html { font-size: ${UI_SIZE.max}px; }`,
    );
  });

  it("emits --font-chat consumed by .chat-content", () => {
    const css = buildTypographyCss({
      ...noTypography,
      chatFont: "Noto Serif, serif",
    });
    expect(css).toContain('--font-chat: "Noto Serif", serif;');
    expect(css).toContain(".chat-content { font-family: var(--font-chat); }");
    expect(css).not.toContain("font-size");
  });

  it("emits chat size with inner text-sm neutralized (mono untouched)", () => {
    const css = buildTypographyCss({ ...noTypography, chatSize: 18 });
    expect(css).toContain("--chat-font-size: 18px;");
    expect(css).toContain(
      ".chat-content { font-size: var(--chat-font-size); }",
    );
    expect(css).toContain(
      ".chat-content :where(.text-sm) { font-size: inherit; }",
    );
    expect(css).not.toContain("font-mono");
    expect(css).not.toContain("font-family");
  });

  it("ignores an unusable custom font string", () => {
    expect(buildTypographyCss({ ...noTypography, uiFont: ";;;" })).toBe("");
  });
});

describe("clampSize", () => {
  it("rounds and clamps into the range", () => {
    expect(clampSize(15.4, CHAT_SIZE)).toBe(15);
    expect(clampSize(5, CHAT_SIZE)).toBe(CHAT_SIZE.min);
    expect(clampSize(50, CHAT_SIZE)).toBe(CHAT_SIZE.max);
  });
});

describe("storage round-trips", () => {
  it("round-trips colors and drops invalid entries", () => {
    storeCustomColors({
      light: { primary: "#3B82F6" },
      dark: { background: "#0a0a0a" },
    });
    expect(getStoredCustomColors()).toEqual({
      light: { primary: "#3b82f6" },
      dark: { background: "#0a0a0a" },
    });

    storeCustomColors({
      light: { background: "#ffffff", surface: "#3B0764", contrast: 9 },
      dark: { contrast: Number.NaN },
    });
    expect(getStoredCustomColors()).toEqual({
      light: { background: "#ffffff", surface: "#3b0764", contrast: 2 },
      dark: {},
    });

    localStorage.setItem(
      "custom-colors",
      JSON.stringify({ light: { primary: "red; }" }, dark: 7 }),
    );
    expect(getStoredCustomColors()).toEqual({ light: {}, dark: {} });

    localStorage.setItem("custom-colors", "not json");
    expect(getStoredCustomColors()).toEqual({ light: {}, dark: {} });
  });

  it("removes the colors key when everything is reset", () => {
    storeCustomColors({ light: { primary: "#3b82f6" }, dark: {} });
    storeCustomColors({ light: {}, dark: {} });
    expect(localStorage.getItem("custom-colors")).toBeNull();
  });

  it("round-trips typography and clamps stored sizes", () => {
    storeTypography({
      uiFont: "Inter",
      chatFont: null,
      uiSize: 17,
      chatSize: 99,
    });
    expect(getStoredTypography()).toEqual({
      uiFont: "Inter",
      chatFont: null,
      uiSize: 17,
      chatSize: CHAT_SIZE.max,
    });

    storeTypography(noTypography);
    expect(localStorage.getItem("custom-typography")).toBeNull();
    expect(getStoredTypography()).toEqual(noTypography);
  });
});

describe("apply* style injection", () => {
  it("injects, replaces, and removes the custom-colors style element", () => {
    applyCustomColors({ light: { primary: "#1d4ed8" }, dark: {} });
    const el = document.getElementById("custom-colors");
    expect(el?.tagName).toBe("STYLE");
    expect(el?.textContent).toContain("--primary: #1d4ed8;");

    applyCustomColors({ light: { primary: "#facc15" }, dark: {} });
    expect(document.querySelectorAll("#custom-colors").length).toBe(1);
    expect(document.getElementById("custom-colors")?.textContent).toContain(
      "#facc15",
    );

    applyCustomColors({ light: {}, dark: {} });
    expect(document.getElementById("custom-colors")).toBeNull();
  });

  it("injects and removes the custom-typography style element", () => {
    applyCustomTypography({ ...noTypography, chatSize: 16 });
    expect(document.getElementById("custom-typography")?.textContent).toContain(
      "--chat-font-size: 16px;",
    );
    applyCustomTypography(noTypography);
    expect(document.getElementById("custom-typography")).toBeNull();
  });
});

describe("chat style persistence (T34)", () => {
  it("defaults to 'default'", () => {
    expect(getStoredChatStyle()).toBe("default");
  });

  it("round-trips a stored style", () => {
    storeChatStyle("bubbles");
    expect(getStoredChatStyle()).toBe("bubbles");
    storeChatStyle("document");
    expect(getStoredChatStyle()).toBe("document");
  });

  it("falls back to 'default' for an unknown stored value", () => {
    localStorage.setItem("chat-style", "bogus");
    expect(getStoredChatStyle()).toBe("default");
  });

  it("removes the key when set back to default", () => {
    storeChatStyle("compact");
    storeChatStyle("default");
    expect(localStorage.getItem("chat-style")).toBeNull();
  });
});

describe("chat list style persistence (T35)", () => {
  it("defaults to 'title'", () => {
    expect(getStoredChatListStyle()).toBe("title");
  });

  it("round-trips a stored style", () => {
    storeChatListStyle("preview");
    expect(getStoredChatListStyle()).toBe("preview");
    storeChatListStyle("title-date");
    expect(getStoredChatListStyle()).toBe("title-date");
  });

  it("falls back to 'title' for an unknown stored value", () => {
    localStorage.setItem("chat-list-style", "bogus");
    expect(getStoredChatListStyle()).toBe("title");
  });

  it("removes the key when set back to title", () => {
    storeChatListStyle("detailed");
    storeChatListStyle("title");
    expect(localStorage.getItem("chat-list-style")).toBeNull();
  });
});
