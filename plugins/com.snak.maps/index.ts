// Maps renderer (```map / ```geojson), as a runtime plugin (migrated from the
// built-in MapView). esbuild bundles leaflet + its CSS (injected at runtime).
//
// Host integration via ctx.invoke (the "commands" permission): the Rust
// `geocode` and `route_directions` commands. Geocoding keeps the same caching +
// 1.1s serialization as the old seam (Nominatim fair-use). Pure GeoJSON helpers
// are imported from the app's @/lib/geo. Streaming-safety is host-side.
//
// Markers are vector circleMarkers (no leaflet marker-icon assets, so nothing
// 404s in the bundle). Popups render model text as textContent (never HTML).

import type { PluginContext } from "@/types/pluginApi";
import L from "leaflet";
import leafletCss from "leaflet/dist/leaflet.css";
import {
  lineWaypoints,
  parseFeatureCollection,
  resolveProfile,
  type FeatureCollection,
  type Position,
  type RouteProfile,
} from "@/lib/geo";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Inject leaflet's CSS once, plus a dark-tile filter matching the app theme. */
function ensureCss() {
  if (document.getElementById("snak-maps-css")) return;
  const style = document.createElement("style");
  style.id = "snak-maps-css";
  style.textContent =
    leafletCss +
    "\n.snak-map-dark .leaflet-layer,.snak-map-dark .leaflet-control-zoom-in," +
    ".snak-map-dark .leaflet-control-zoom-out{filter:invert(1) hue-rotate(180deg) brightness(0.95) contrast(0.9);}";
  document.head.appendChild(style);
}

function cssVar(name: string): string {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  if (!v) return "";
  return /^[\d.]/.test(v) ? `oklch(${v})` : v;
}

function showSource(el: HTMLElement, code: string) {
  const pre = document.createElement("pre");
  pre.textContent = code;
  pre.className =
    "border-border bg-background/60 my-2 overflow-x-auto rounded-md border p-3 font-mono text-xs";
  el.replaceChildren(pre);
}

type Invoke = NonNullable<PluginContext["invoke"]>;

/** Geocode + road-snap features, mirroring the old MapView resolveFeatures. */
function makeResolver(invoke: Invoke) {
  const cache = new Map<string, Promise<Position | null>>();
  let tail: Promise<unknown> = Promise.resolve();
  const geocode = (query: string): Promise<Position | null> => {
    const key = query.trim().toLowerCase();
    if (!key) return Promise.resolve(null);
    const hit = cache.get(key);
    if (hit) return hit;
    const result = tail.then(() =>
      invoke<Position | null>("geocode", { query }),
    );
    cache.set(key, result);
    result.catch(() => cache.delete(key));
    tail = result.then(
      () => sleep(1100),
      () => sleep(1100),
    );
    return result;
  };

  return async (fc: FeatureCollection): Promise<FeatureCollection> => {
    const located = [];
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
          /* keep original geometry */
        }
      }
      located.push(f);
    }
    const features = await Promise.all(
      located.map(async (f) => {
        const profile = resolveProfile((f.properties ?? {}).snap);
        const wp = profile ? lineWaypoints(f as never) : null;
        if (!profile || !wp) return f;
        try {
          const snapped = await invoke<Position[]>("route_directions", {
            waypoints: wp,
            profile: profile as RouteProfile,
          });
          return { ...f, geometry: { type: "LineString", coordinates: snapped } };
        } catch {
          return f;
        }
      }),
    );
    return { type: "FeatureCollection", features } as FeatureCollection;
  };
}

function renderMap(
  el: HTMLElement,
  code: string,
  resolve: (fc: FeatureCollection) => Promise<FeatureCollection>,
) {
  const parsed = parseFeatureCollection(code);
  if (!parsed) {
    showSource(el, code);
    return () => {};
  }
  ensureCss();

  const dark = document.documentElement.classList.contains("dark");
  const container = document.createElement("div");
  container.setAttribute("role", "application");
  container.className =
    "isolate border-border bg-background/60 my-2 h-80 max-h-[80vh] min-h-48 w-full resize-y overflow-hidden rounded-md border" +
    (dark ? " snak-map-dark" : "");
  el.replaceChildren(container);

  let cancelled = false;
  let map: L.Map | undefined;
  let ro: ResizeObserver | undefined;
  void (async () => {
    const fc = await resolve(parsed);
    if (cancelled) return;
    const accent = cssVar("--primary") || "#3b82f6";
    const m = L.map(container, { scrollWheelZoom: false });
    map = m;
    ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(container);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(m);
    const layer = L.geoJSON(fc as unknown as Parameters<typeof L.geoJSON>[0], {
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
          const d = document.createElement("div");
          d.textContent = body;
          lyr.bindPopup(d);
        }
        if (typeof p.label === "string" && p.label.trim()) lyr.bindTooltip(p.label);
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
}

const MAPS_SYSTEM = [
  "## Maps",
  "To show places or routes on a map, emit a fenced code block tagged `map` " +
    "containing a single GeoJSON FeatureCollection. Point features are markers " +
    "— put a short `label` (hover) and/or `popup`/`description` (click) and an " +
    "optional `category` in their `properties`. LineString features are paths: " +
    'to snap a path to real roads set `properties.snap` to "driving", ' +
    '"walking", or "cycling" with the route\'s waypoints as the line\'s ' +
    "coordinates; otherwise the line is drawn exactly as given. Polygon " +
    "features are filled areas. Coordinates are [longitude, latitude].",
  "IMPORTANT — locating real places: do NOT guess latitude/longitude for a " +
    "real-world place or street address. Instead set `properties.address` to " +
    "the place name or full address and set the feature's `geometry` to null — " +
    "the app geocodes it to exact coordinates via OpenStreetMap. Use explicit " +
    "coordinates only for points you genuinely know or for abstract data.",
  "The app fits the view to your data automatically. Use a map when geography " +
    "makes the answer clearer than text.",
].join("\n");

export function activate(ctx: PluginContext) {
  const invoke = ctx.invoke;
  // Without the commands capability we can't geocode/route — degrade to drawing
  // the raw geometry (resolver is identity).
  const resolve = invoke
    ? makeResolver(invoke)
    : (fc: FeatureCollection) => Promise.resolve(fc);
  ctx.ui.registerRenderer("map", (el, code) => renderMap(el, code, resolve));
  ctx.ui.registerRenderer("geojson", (el, code) => renderMap(el, code, resolve));
  ctx.llm?.registerHook({ systemPrompt: () => MAPS_SYSTEM });
}
