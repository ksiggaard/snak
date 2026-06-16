import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { resolveCssVarColor, resolveTheme } from "@/lib/theme";
import { useTheme } from "@/store/theme";
import { useT } from "@/store/i18n";
import {
  lineWaypoints,
  parseFeatureCollection,
  resolveProfile,
  type FeatureCollection,
} from "@/lib/geo";
import { routeDirections } from "@/lib/routing";

/**
 * Renders a ```map (or ```geojson) fenced block as an interactive OpenStreetMap
 * map. Enabled via the built-in `renderer` plugin `com.snak.maps` (disabled by
 * default); when disabled `CodeBlock` shows the raw GeoJSON and this component
 * is never mounted.
 *
 * - **Lazy:** Leaflet + its CSS are dynamically imported so they stay out of the
 *   main bundle until a map renders.
 * - **Streaming-safe:** `parseFeatureCollection` gates rendering — partial JSON
 *   during a stream does not parse, so the raw source shows until the complete
 *   FeatureCollection arrives, then the map mounts.
 * - **Routing:** LineStrings with `properties.snap` are snapped to roads via the
 *   Rust `route_directions` command (Valhalla); on any failure the straight-line
 *   waypoints are drawn instead, so a route always renders.
 * - **Theming:** a dark-mode CSS filter on the tile layer tracks the app theme.
 * - **Safety:** popups render model text as `textContent` (never HTML); markers
 *   are vector `circleMarker`s (no remote icon assets).
 */
export function MapView({ code }: { code: string }) {
  const t = useT();
  const theme = useTheme((s) => s.theme);
  const resolved = resolveTheme(theme);
  const containerRef = useRef<HTMLDivElement>(null);
  // Memoized so the effect dependency is stable across unrelated re-renders.
  const parsed = useMemo(() => parseFeatureCollection(code), [code]);

  useEffect(() => {
    if (!parsed || !containerRef.current) return;
    let cancelled = false;
    let map: { remove: () => void } | undefined;
    void (async () => {
      // Leaflet 1.9 ships only a CJS bundle (no "module"/"exports" field), so
      // Vite bundles it as a CommonJS module and exposes the namespace as the
      // `.default` property of the dynamic import result.
      const Lns = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L = (Lns as any).default as typeof Lns;
      if (cancelled || !containerRef.current) return;

      const fc = await resolveRoutes(parsed);
      if (cancelled || !containerRef.current) return;

      const accent = resolveCssVarColor("--primary") || "#3b82f6";
      const m = L.map(containerRef.current, { scrollWheelZoom: false });
      map = m;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors",
      }).addTo(m);

      const layer = L.geoJSON(fc as unknown as GeoJSON.GeoJsonObject, {
        pointToLayer: (_f, latlng) =>
          L.circleMarker(latlng, {
            radius: 7,
            color: accent,
            weight: 2,
            fillColor: accent,
            fillOpacity: 0.7,
          }),
        style: (f) => ({
          color: (f?.properties?.color as string) || accent,
          weight: 4,
          opacity: 0.85,
        }),
        onEachFeature: (f, lyr) => {
          const p = (f.properties ?? {}) as Record<string, unknown>;
          const body = p.popup ?? p.description ?? p.label;
          if (typeof body === "string" && body.trim()) {
            const el = document.createElement("div");
            el.textContent = body; // text only — never inject model HTML
            lyr.bindPopup(el);
          }
          if (typeof p.label === "string" && p.label.trim()) {
            lyr.bindTooltip(p.label);
          }
        },
      }).addTo(m);

      try {
        const b = layer.getBounds();
        if (b.isValid()) m.fitBounds(b, { padding: [24, 24] });
        else m.setView([0, 0], 2);
      } catch {
        m.setView([0, 0], 2);
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
    // `resolved` is intentionally NOT a dependency: the dark-mode tile filter is
    // a CSS class on the container (applied in JSX), so a theme toggle restyles
    // the existing map without tearing it down and re-running the routing calls.
  }, [parsed]);

  if (!parsed) {
    // Raw source: initial / streaming / invalid state.
    return (
      <pre className="border-border bg-background/60 my-2 overflow-x-auto rounded-md border p-3 font-mono text-xs">
        {code}
      </pre>
    );
  }

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label={t("chat.mapLabel")}
      className={cn(
        "border-border bg-background/60 my-2 h-80 w-full overflow-hidden rounded-md border",
        resolved === "dark" && "snak-map-dark",
      )}
    />
  );
}

/**
 * Replace the geometry of every routable LineString (one with a resolvable
 * `properties.snap`) with road-snapped coordinates from the routing command.
 * Non-routable features pass through untouched; a routing failure keeps the
 * original straight-line waypoints.
 */
async function resolveRoutes(
  fc: FeatureCollection,
): Promise<FeatureCollection> {
  const features = await Promise.all(
    fc.features.map(async (f) => {
      const profile = resolveProfile((f.properties ?? {}).snap);
      const wp = profile ? lineWaypoints(f) : null;
      if (!profile || !wp) return f;
      try {
        const snapped = await routeDirections(wp, profile);
        return {
          ...f,
          geometry: { type: "LineString", coordinates: snapped },
        };
      } catch {
        return f; // fall back to the straight-line waypoints
      }
    }),
  );
  return { type: "FeatureCollection", features };
}
