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
  type GeoFeature,
} from "@/lib/geo";
import { routeDirections } from "@/lib/routing";
import { geocode } from "@/lib/geocode";

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
    let ro: ResizeObserver | undefined;
    void (async () => {
      // Leaflet 1.9 ships only a CJS bundle (no "module"/"exports" field), so
      // Vite bundles it as a CommonJS module and exposes the namespace as the
      // `.default` property of the dynamic import result.
      const Lns = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L = (Lns as any).default as typeof Lns;
      if (cancelled || !containerRef.current) return;

      const fc = await resolveFeatures(parsed);
      if (cancelled || !containerRef.current) return;

      const accent = resolveCssVarColor("--primary") || "#3b82f6";
      const el = containerRef.current;
      const m = L.map(el, { scrollWheelZoom: false });
      map = m;
      // The card is user-resizable (CSS `resize-y`); Leaflet doesn't observe
      // container size changes itself, so repaint it to fill the new height.
      ro = new ResizeObserver(() => m.invalidateSize());
      ro.observe(el);
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
      ro?.disconnect();
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
        // `isolate` (isolation: isolate) is load-bearing: Leaflet gives its
        // panes/controls high z-indexes (up to 1000 for zoom controls) which,
        // without a stacking context here, would resolve against the root and
        // paint over the app's z-50 overlay layer (dropdowns, popovers, etc.).
        // Isolating the map traps those z-indexes inside it while preserving
        // Leaflet's own internal layering (popups > markers > tiles).
        "isolate border-border bg-background/60 my-2 h-80 max-h-[80vh] min-h-48 w-full resize-y overflow-hidden rounded-md border",
        resolved === "dark" && "snak-map-dark",
      )}
    />
  );
}

/**
 * Resolve a parsed FeatureCollection into one ready to draw:
 *  1. Geocode features that name a place via `properties.address` (Nominatim),
 *     replacing their geometry with the precise point — so the model can name
 *     real addresses instead of guessing coordinates. Done first and serially
 *     (the geocoder is rate-limited); a failed lookup keeps the original
 *     geometry (which may be null, in which case Leaflet just skips it).
 *  2. Snap routable LineStrings (those with a resolvable `properties.snap`) to
 *     roads via the routing command; a routing failure keeps the straight-line
 *     waypoints. Done in parallel.
 */
async function resolveFeatures(
  fc: FeatureCollection,
): Promise<FeatureCollection> {
  // 1) Geocode address-based points (serialized inside geocode() for fair-use).
  const located: GeoFeature[] = [];
  for (const f of fc.features) {
    const address = (f.properties ?? {}).address;
    if (typeof address === "string" && address.trim()) {
      try {
        const pt = await geocode(address);
        if (pt) {
          located.push({ ...f, geometry: { type: "Point", coordinates: pt } });
          continue;
        }
      } catch {
        // Geocoding failed — fall through and keep the model's own geometry.
      }
    }
    located.push(f);
  }

  // 2) Snap routable LineStrings to roads.
  const features = await Promise.all(
    located.map(async (f) => {
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
