import { describe, it, expect } from "vitest";
import { buildChartsSystemText } from "@/lib/charts";
import type { HostRegistry } from "@/lib/plugins";

const registry = (languages: string[]): HostRegistry => ({
  providers: [],
  themes: [],
  skills: [],
  slashCommands: [],
  renderers: languages.map((language) => ({ language })),
});

describe("buildChartsSystemText", () => {
  it("returns empty string when the charts renderer is disabled", () => {
    expect(buildChartsSystemText(registry([]))).toBe("");
    expect(buildChartsSystemText(registry(["mermaid"]))).toBe("");
  });

  it("returns the chart instruction when the vega-lite renderer is enabled", () => {
    const out = buildChartsSystemText(registry(["mermaid", "vega-lite"]));
    expect(out).toContain("## Charts");
    expect(out).toContain("`vega-lite`");
    expect(out).toContain("data.values");
  });

  it("matches the renderer language case-insensitively", () => {
    expect(buildChartsSystemText(registry(["Vega-Lite"]))).toContain(
      "## Charts",
    );
  });
});
