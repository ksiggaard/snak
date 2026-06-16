// Maps auto-instruct (com.snak.maps). Mirrors `charts.ts`: the maps renderer
// (`src/components/chat/MapView.tsx`) draws ```map / ```geojson fences as
// interactive maps, but a model won't emit them unless it knows the host
// renders them. This builds a short system block teaching the fence, gated on
// the renderer being enabled — so enabling/disabling the plugin toggles both
// the renderer and this instruction together.

import { hasRenderer, type HostRegistry } from "@/lib/plugins";

/**
 * Build the system text that tells the model it can render maps. Returns an
 * empty string when the maps renderer is disabled, so callers skip the system
 * message and chats are unaffected when the plugin is off.
 */
export function buildMapsSystemText(reg: HostRegistry): string {
  if (!hasRenderer(reg, "map")) return "";
  return [
    "## Maps",
    "To show places or routes on a map, emit a fenced code block tagged `map` " +
      "containing a single GeoJSON FeatureCollection. Point features are " +
      "markers — put a short `label` (hover) and/or `popup`/`description` " +
      "(click) and an optional `category` in their `properties`. LineString " +
      "features are paths: to snap a path to real roads set `properties.snap` " +
      'to "driving", "walking", or "cycling" with the route\'s waypoints as the ' +
      "line's coordinates; otherwise the line is drawn exactly as given. " +
      "Polygon features are filled areas. Coordinates are [longitude, latitude].",
    "IMPORTANT — locating real places: do NOT guess latitude/longitude for a " +
      "real-world place or street address (guessed coordinates land the marker " +
      "in the wrong spot). Instead set `properties.address` to the place name or " +
      'full address (e.g. "Colosseum, Rome" or "1600 Pennsylvania Ave NW, ' +
      'Washington DC") and set the feature\'s `geometry` to null — the app ' +
      "geocodes the address to exact coordinates via OpenStreetMap. Use explicit " +
      "`[longitude, latitude]` coordinates only for points you genuinely know or " +
      "for abstract/non-map data.",
    "The app fits the view to your data automatically. Use a map when geography " +
      "(locations, directions, a trip plan) makes the answer clearer than text.",
  ].join("\n");
}
