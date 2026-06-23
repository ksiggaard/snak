// Charts renderer (vega / vega-lite), as a runtime plugin (migrated from the
// built-in CodeBlock branch). esbuild bundles vega-embed into a single main.js.
//
// - Registers both the "vega-lite" and "vega" fenced languages.
// - Contributes the charts auto-instruct system prompt via an llm-hook (replaces
//   the old buildChartsSystemText wired into the chat send path).
// - Security: remote/file data loads are blocked (inline data.values only).
// - Streaming-safety is handled host-side (PluginRenderedBlock).
// Accepted regressions vs the old built-in: the click-to-enlarge lightbox is
// dropped (ctx exposes no lightbox).

import type { PluginContext } from "@/types/pluginApi";
import vegaEmbed, { vega } from "vega-embed";

// Multi-hue categorical palette (the app's --chart-* tokens are grayscale).
const CATEGORY_PALETTE = [
  "#dc8add",
  "#62a0ea",
  "#57e389",
  "#f9c440",
  "#ff7800",
  "#f66151",
  "#9141ac",
  "#33c7de",
];

/** Read a CSS custom property as a color, wrapping bare oklch components
 * (Tailwind v4) in oklch(). */
function cssColor(name: string): string {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  if (!v) return "#888888";
  return /^[\d.]/.test(v) ? `oklch(${v})` : v;
}

function buildVegaConfig(): Record<string, unknown> {
  const fg = cssColor("--foreground");
  const muted = cssColor("--muted-foreground");
  const border = cssColor("--border");
  return {
    background: "transparent",
    view: { stroke: "transparent" },
    axis: {
      labelColor: muted,
      titleColor: fg,
      gridColor: border,
      domainColor: border,
      tickColor: border,
    },
    legend: { labelColor: muted, titleColor: fg },
    title: { color: fg, subtitleColor: muted },
    range: { category: CATEGORY_PALETTE },
  };
}

function showSource(el: HTMLElement, code: string) {
  const pre = document.createElement("pre");
  pre.textContent = code;
  pre.className =
    "border-border bg-background/60 my-2 overflow-x-auto rounded-md border p-3 font-mono text-xs";
  el.replaceChildren(pre);
}

function render(el: HTMLElement, code: string, mode: "vega-lite" | "vega") {
  let parsed: unknown;
  try {
    parsed = JSON.parse(code);
  } catch {
    showSource(el, code);
    return () => {};
  }
  if (!parsed || typeof parsed !== "object") {
    showSource(el, code);
    return () => {};
  }

  let cancelled = false;
  let result: { finalize: () => void } | undefined;
  void (async () => {
    try {
      // Block all remote/file data loads (inline data.values is unaffected).
      const loader = vega.loader();
      loader.load = () => Promise.reject(new Error("remote data disabled"));
      if (cancelled) return;
      const opts = {
        mode,
        renderer: "svg",
        actions: { export: true, source: false, compiled: false, editor: false },
        loader,
        config: buildVegaConfig(),
        tooltip: true,
      } as Parameters<typeof vegaEmbed>[2];
      const r = await vegaEmbed(
        el,
        parsed as Parameters<typeof vegaEmbed>[1],
        opts,
      );
      if (cancelled) {
        r.finalize();
        return;
      }
      result = r;
    } catch {
      if (!cancelled) showSource(el, code);
    }
  })();
  return () => {
    cancelled = true;
    result?.finalize();
  };
}

const CHARTS_SYSTEM = [
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

export function activate(ctx: PluginContext) {
  ctx.ui.registerRenderer("vega-lite", (el, code) => render(el, code, "vega-lite"));
  ctx.ui.registerRenderer("vega", (el, code) => render(el, code, "vega"));
  ctx.llm?.registerHook({ systemPrompt: () => CHARTS_SYSTEM });
}
