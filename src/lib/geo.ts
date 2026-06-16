// Pure GeoJSON helpers for the maps renderer (com.snak.maps). No IO, no Leaflet:
// parsing/validation and snap→profile/waypoint logic live here so they are unit-
// testable; `MapView` consumes them. Coordinates are GeoJSON order: [lng, lat].

export type Position = [number, number];

export interface GeoFeature {
  type: "Feature";
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown> | null;
}

export interface FeatureCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

/** Valhalla costing models exposed via `properties.snap`. */
export type RouteProfile = "auto" | "pedestrian" | "bicycle";

/**
 * Parse text into a GeoJSON FeatureCollection, or null if it is not valid/
 * complete. Doubles as the streaming gate: partial JSON throws in `JSON.parse`
 * → null → the caller shows the raw source until the full object arrives.
 */
export function parseFeatureCollection(text: string): FeatureCollection | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.type !== "FeatureCollection" || !Array.isArray(o.features)) return null;
  return o as unknown as FeatureCollection;
}

/**
 * Map a `properties.snap` value to a Valhalla costing model, or null when the
 * line should be drawn as-is (snap absent/false/unknown). `true` → driving.
 */
export function resolveProfile(snap: unknown): RouteProfile | null {
  if (snap === true) return "auto";
  if (typeof snap !== "string") return null;
  switch (snap.toLowerCase()) {
    case "driving":
    case "auto":
    case "car":
      return "auto";
    case "walking":
    case "pedestrian":
    case "foot":
      return "pedestrian";
    case "cycling":
    case "bicycle":
    case "bike":
      return "bicycle";
    default:
      return null;
  }
}

/**
 * The waypoints ([lng,lat] positions) of a LineString feature, or null if the
 * feature is not a LineString with at least two numeric positions.
 */
export function lineWaypoints(feature: GeoFeature): Position[] | null {
  const g = feature.geometry;
  if (!g || g.type !== "LineString" || !Array.isArray(g.coordinates)) {
    return null;
  }
  const pts = g.coordinates
    .filter(
      (p): p is Position =>
        Array.isArray(p) &&
        p.length >= 2 &&
        typeof p[0] === "number" &&
        typeof p[1] === "number",
    )
    .map((p) => [p[0], p[1]] as Position);
  return pts.length >= 2 ? pts : null;
}
