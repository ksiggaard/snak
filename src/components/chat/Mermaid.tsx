import { useEffect, useId, useState } from "react";
import { resolveTheme } from "@/lib/theme";
import { openLightboxSvg } from "@/store/lightbox";
import { useTheme } from "@/store/theme";
import { useT } from "@/store/i18n";

/**
 * Renders a ```mermaid fenced block (T42) as a diagram. Enabled via the
 * built-in `renderer` plugin `com.snak.mermaid`; when that plugin is disabled
 * the `CodeBlock` shows the raw source instead (this component is never
 * mounted).
 *
 * - **Lazy:** mermaid is a large dependency, dynamically imported so it stays
 *   out of the main bundle until a diagram actually renders.
 * - **Streaming-safe:** the source grows token-by-token during a stream, so it
 *   is incomplete/invalid most of the time. `mermaid.parse(..., { suppressErrors })`
 *   gates rendering — invalid source never throws; we fall back to showing the
 *   raw text (which also doubles as the live "source so far" view) until it
 *   parses, then swap in the rendered SVG.
 * - **Theming:** re-renders with mermaid's dark/default theme to match the
 *   app's resolved light/dark mode.
 * - **Safety:** mermaid renders with `securityLevel: "strict"` (its built-in
 *   DOMPurify sanitization strips scripts and escapes HTML labels), so the
 *   model-authored source can't inject active content via the SVG.
 */
export function Mermaid({ code }: { code: string }) {
  const t = useT();
  const theme = useTheme((s) => s.theme);
  const resolved = resolveTheme(theme);
  // useId is unique per instance but not a valid CSS id on its own (":r0:");
  // mermaid.render needs a DOM-id-safe string, so strip non-alphanumerics.
  const renderId = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  // null = show the raw source (initial paint, streaming, or a parse failure);
  // a string = the rendered SVG markup.
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: resolved === "dark" ? "dark" : "default",
        });
        const ok = await mermaid.parse(code, { suppressErrors: true });
        if (cancelled) return;
        if (!ok) {
          setSvg(null);
          return;
        }
        const rendered = await mermaid.render(renderId, code);
        if (!cancelled) setSvg(rendered.svg);
      } catch {
        // Any unexpected failure → fall back to the raw source.
        if (!cancelled) setSvg(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, resolved, renderId]);

  if (svg) {
    return (
      <button
        type="button"
        onClick={() => openLightboxSvg(svg)}
        aria-label={t("chat.viewDiagram")}
        title={t("chat.viewDiagram")}
        className="focus-visible:ring-ring my-2 flex w-full cursor-zoom-in justify-center overflow-x-auto rounded-md focus-visible:ring-2 focus-visible:outline-none"
        // SVG comes from mermaid's own renderer (securityLevel:"strict"),
        // not from raw model HTML — sanitized by mermaid before we inject it.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }
  // Raw source: initial/streaming/invalid state.
  return (
    <pre className="border-border bg-background/60 my-2 overflow-x-auto rounded-md border p-3 font-mono text-xs">
      {code}
    </pre>
  );
}
