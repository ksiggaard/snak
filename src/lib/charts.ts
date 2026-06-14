// Charts auto-instruct (com.snak.charts).
//
// The charts renderer (`src/components/chat/VegaChart.tsx`) draws ```vega-lite
// (and ```vega) fenced blocks as charts, but a model won't emit those fences
// unless it knows the host renders them. So — mirroring how `skills.ts` injects
// instruction text for enabled skill plugins — this builds a short system block
// that teaches the model the chart fence, gated on the renderer being enabled.
//
// It reads the same T12 host registry as the renderer (`hasRenderer`), so
// enabling/disabling the Charts plugin toggles both the renderer *and* this
// instruction together — no separate state. The composition is a pure function
// so it can be unit-tested and wired into `store/threads.ts` with one line.

import { hasRenderer, type HostRegistry } from "@/lib/plugins";

/**
 * Build the system text that tells the model it can render charts. Returns an
 * empty string when the charts renderer is disabled — so callers skip adding a
 * system message and chats are unaffected when the plugin is off.
 */
export function buildChartsSystemText(reg: HostRegistry): string {
  if (!hasRenderer(reg, "vega-lite")) return "";
  return [
    "## Charts",
    "To visualize data, render a chart by emitting a fenced code block tagged " +
      "`vega-lite` containing a complete, self-contained Vega-Lite v5 JSON " +
      "specification. Embed the data inline via `data.values` — remote " +
      "`data.url` references are blocked and will not load. The app renders the " +
      "block as a chart automatically (the raw spec is shown while it streams). " +
      "Use charts when they make data clearer than text (comparisons, trends, " +
      "distributions, proportions). For advanced cases not expressible in " +
      "Vega-Lite, a full Vega spec in a `vega` fence is also supported.",
  ].join("\n");
}
