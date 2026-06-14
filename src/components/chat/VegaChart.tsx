import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2 } from "lucide-react";
import { resolveCssVarColor, resolveTheme } from "@/lib/theme";
import { openLightboxSvg } from "@/store/lightbox";
import { useTheme } from "@/store/theme";
import { useT } from "@/store/i18n";

/**
 * Renders a ```vega-lite (or ```vega) fenced block as a chart. Enabled via the
 * built-in `renderer` plugin `com.snak.charts`; when that plugin is disabled the
 * `CodeBlock` shows the raw spec instead (this component is never mounted).
 *
 * - **Lazy:** vega/vega-lite are large dependencies, dynamically imported so they
 *   stay out of the main bundle until a chart actually renders.
 * - **Streaming-safe:** the spec grows token-by-token during a stream, so it is
 *   incomplete most of the time. `JSON.parse` gates rendering — until the spec
 *   parses to a complete object we show the raw source (which doubles as the live
 *   "spec so far" view), then swap in the chart. A complete-but-invalid spec
 *   throws in `vega-embed` and falls back to the raw source too.
 * - **Theming:** a `config` derived from the app's CSS variables (resolved at
 *   render time) tracks the active light/dark theme; the chart re-embeds when the
 *   resolved theme changes.
 * - **Safety:** Vega can fetch remote data via `data.url`. The loader's `load` is
 *   overridden to reject every fetch, so a model-authored spec cannot trigger
 *   outbound requests — only inline `data.values` works. Vega's expression
 *   language is sandboxed (no arbitrary JS), so there is no script-injection path.
 */

// A multi-hue categorical palette (the app's own `--chart-*` tokens are
// grayscale). Built around the accent so charts feel native rather than gray.
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

/** A Vega(-Lite) `config` that maps the chart onto the active theme's colors. */
function buildVegaConfig(): Record<string, unknown> {
  const fg = resolveCssVarColor("--foreground");
  const muted = resolveCssVarColor("--muted-foreground");
  const border = resolveCssVarColor("--border");
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

export function VegaChart({
  code,
  mode,
}: {
  code: string;
  mode: "vega-lite" | "vega";
}) {
  const t = useT();
  const theme = useTheme((s) => s.theme);
  const resolved = resolveTheme(theme);

  // A complete object → render the chart; null → show the raw source (initial
  // paint or mid-stream, when the spec is still partial/invalid JSON).
  const parsed = useMemo<unknown>(() => {
    try {
      const v: unknown = JSON.parse(code);
      return v && typeof v === "object" ? v : null;
    } catch {
      return null;
    }
  }, [code]);

  // A complete spec that vega-embed rejects → fall back to the raw source.
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<{ toSVG: () => Promise<string> } | null>(null);

  useEffect(() => {
    if (!parsed || !containerRef.current) return;
    let cancelled = false;
    let result: { finalize: () => void } | undefined;
    setFailed(false);
    void (async () => {
      try {
        const mod = await import("vega-embed");
        const vegaEmbed = mod.default;
        // Block all remote/file data loads (inline `data.values` is unaffected).
        const loader = mod.vega.loader();
        loader.load = () => Promise.reject(new Error("remote data disabled"));
        if (cancelled || !containerRef.current) return;
        const opts = {
          mode,
          renderer: "svg",
          actions: {
            export: true,
            source: false,
            compiled: false,
            editor: false,
          },
          loader,
          config: buildVegaConfig(),
          tooltip: true,
        } as Parameters<typeof vegaEmbed>[2];
        const r = await vegaEmbed(
          containerRef.current,
          parsed as Parameters<typeof vegaEmbed>[1],
          opts,
        );
        if (cancelled) {
          r.finalize();
          return;
        }
        result = r;
        viewRef.current = r.view;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      result?.finalize();
      viewRef.current = null;
    };
  }, [parsed, resolved, mode]);

  const onExpand = async () => {
    const view = viewRef.current;
    if (!view) return;
    try {
      const svg = await view.toSVG();
      openLightboxSvg(svg, resolveCssVarColor("--card"));
    } catch {
      // toSVG can fail on a finalized view; ignore.
    }
  };

  if (!parsed || failed) {
    // Raw source: initial / streaming / invalid state.
    return (
      <pre className="border-border bg-background/60 my-2 overflow-x-auto rounded-md border p-3 font-mono text-xs">
        {code}
      </pre>
    );
  }

  return (
    <div className="border-border bg-background/60 group relative my-2 overflow-hidden rounded-md border p-3">
      <div ref={containerRef} className="overflow-x-auto" />
      <button
        type="button"
        onClick={onExpand}
        aria-label={t("chat.viewChart")}
        title={t("chat.viewChart")}
        className="bg-background/80 text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-1 right-1 inline-flex cursor-zoom-in items-center rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
      >
        <Maximize2 className="size-3.5" />
      </button>
    </div>
  );
}
