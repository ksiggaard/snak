> 📐 **Historical design doc.** A dated, point-in-time design record — kept for the
> rationale, not as current truth. For how the feature works today,
> [`AGENTS.md`](../../../AGENTS.md) is canonical; where this doc and the code disagree,
> the code wins.

# OpenStreetMap renderer plugin (`com.snak.maps`)

**Date:** 2026-06-16
**Status:** Designed
**Builds on:** `2026-06-09-plugin-foundation-design.md` (T12, the renderer plugin category + host registry), the existing `com.snak.charts` / `com.snak.mermaid` renderer plugins (the pattern this mirrors)

## Problem

snak can already turn assistant-authored fenced blocks into live visuals — `mermaid`
diagrams and `vega-lite` charts — via **renderer** plugins. There is no equivalent for
geography. When a model talks about places, directions, or a trip, the best it can do is
describe them in prose or drop coordinates the user must paste elsewhere.

We want models to **show places and routes on a map**, and to express simple route plans
between points of interest. The capability must be **opt-in (disabled by default)** and
require **no API key** — consistent with snak's bring-your-own-key, privacy-respecting
posture.

## Goal

A built-in **renderer** plugin, `com.snak.maps`, identical in mechanics to `com.snak.charts`:
the model emits a fenced ` ```map ` block containing a **GeoJSON FeatureCollection**, and the
app renders it as an interactive [Leaflet](https://leafletjs.com/) map over OpenStreetMap
tiles — pannable/zoomable, with clickable marker popups and road-snapped routes. The plugin is
**disabled by default** and needs **no key**.

**Invariant:** with the plugin disabled (the default), behavior is byte-identical to today —
a ` ```map ` / ` ```geojson ` fence renders as a plain code block and no map-related system
text is sent. This matches every other renderer plugin.

## Decisions

- **Renderer plugin, not a new mechanism.** `category: "renderer"`, `contributes:
  { language: "map" }`, `enabledByDefault: false`. Registered as a built-in
  (`src-tauri/src/plugins/builtin/maps.json` + one `include_str!` line in `plugins/mod.rs`).
  Enabled/disabled from **Settings → Plugins** (the existing `Plugins.tsx` card, renderer
  group) — no new settings UI.

- **Format: pure GeoJSON.** The model emits a standard `FeatureCollection`. No custom
  top-level keys — all extras ride in the standard `properties` bag, so the payload is valid
  GeoJSON that models already produce reliably:
  - **Point** → marker. `properties`: `label` (hover tooltip), `popup`/`description` (popup
    body, rendered as **text**), `category` (optional POI hint → marker color).
  - **LineString** → route/path. `properties.snap: "driving" | "walking" | "cycling"` (or
    `true` → driving) → treat the line's coordinates as **waypoints** and replace them with a
    road-snapped route from the routing engine; absent → draw the line as given. Optional
    `color`, `label`.
  - **Polygon** → filled area (handled for free by Leaflet's GeoJSON layer).
  - The map **auto-fits its viewport** to the bounds of all features — no center/zoom guessing
    and no non-standard fields.

- **Two fence tags, one contribution.** `CodeBlock` renders both ` ```map ` and ` ```geojson `
  as maps when the plugin is enabled, exactly as `charts` governs both `vega-lite` and `vega`.
  ` ```map ` is the tag taught via auto-instruct; ` ```geojson ` is caught because a user who
  opted in almost always wants GeoJSON shown as a map. Anything that does not parse to a valid
  FeatureCollection falls back to the raw source.

- **Routing engine: FOSSGIS-hosted Valhalla** (`https://valhalla1.openstreetmap.de/route`) —
  free, no key, global, same fair-use policy as the OSRM/Nominatim demo servers. Chosen over
  the OSRM demo because Valhalla covers **driving (`auto`), walking (`pedestrian`), and cycling
  (`bicycle`)** in one engine, satisfying the multi-modal ask. `snap` values map:
  `driving→auto`, `walking→pedestrian`, `cycling→bicycle`.

- **Routing runs in a Rust command.** `commands/routing.rs` exposes
  `route_directions(waypoints, mode) -> Result<Vec<[f64; 2]>>`, called over `reqwest` (already
  a dependency). Reasons: avoids any CORS question, lets us send a proper
  `User-Agent: snak/<version>` for fair-use compliance, and matches snak's "outbound calls in
  Rust" architecture rule. App commands need no capability entry (consistent with
  `extract_document_text` / `take_screenshot`); it is added to `generate_handler!` in `lib.rs`.

- **Polyline decode.** Valhalla returns the route as a Google-encoded polyline at **precision
  6** (`trip.legs[].shape`). The command decodes it to `[lng, lat]` pairs (a ~15-line,
  unit-tested function) and returns those, so the frontend receives plain coordinates.

- **Graceful fallback.** Any routing failure (rate-limit, offline, no route) falls back to
  drawing the straight-line waypoints the model supplied, so a route always renders. Mirrors
  the YouTube-embed "degrade gracefully" pattern.

- **Lazy + imperative rendering.** `MapView.tsx` drives Leaflet imperatively in a `useEffect`
  with a container `ref` — the same shape as `VegaChart.tsx` — and dynamically imports both
  `leaflet` and its CSS so the library stays out of the main bundle until a map renders.

- **Streaming-safe.** Like `VegaChart`, a `JSON.parse` gate shows the raw source while the
  GeoJSON is still streaming (partial/invalid); once it parses to a valid FeatureCollection the
  map mounts. A complete-but-invalid payload also falls back to raw source.

- **Theme-aware.** In dark mode a CSS filter is applied to the tile layer (invert + hue-rotate,
  a standard raster-basemap dark trick) and the surrounding card/controls use theme tokens; the
  map re-applies on theme change, mirroring the other renderers.

## Architecture & components

Data flow (enabled plugin):

```
assistant message
  └─ ```map fence (GeoJSON FeatureCollection)
       └─ CodeBlock: hasRenderer(registry, "map") && lang ∈ {map, geojson}
            └─ <MapView code={text}/>
                 ├─ geo.ts: parseFeatureCollection(code)        (JSON.parse gate)
                 ├─ Leaflet (lazy): tiles + markers + polygons + lines
                 └─ for each LineString with properties.snap:
                      └─ route_directions(waypoints, mode)  ── Rust/reqwest ──▶ Valhalla
                           └─ decoded [lng,lat][]  →  replace line geometry
                              (on failure: keep straight waypoints)
```

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `src-tauri/src/plugins/builtin/maps.json` | Manifest (renderer, `language: map`, off by default) | — |
| `src-tauri/src/commands/routing.rs` | `route_directions` command: call Valhalla, decode polyline6, return coords; `decode_polyline6` helper | `reqwest` |
| `src/components/chat/MapView.tsx` | Render the map (lazy Leaflet, streaming-safe, themed, text popups, route snapping) | `geo.ts`, `lib/routing.ts` |
| `src/lib/geo.ts` | Pure: `parseFeatureCollection`, extract waypoints from a LineString, resolve `snap`→mode, bounds computation | — |
| `src/lib/routing.ts` | Frontend wrapper over the `route_directions` command | `@tauri-apps/api` |
| `src/lib/maps.ts` | `buildMapsSystemText(reg)` auto-instruct, gated on `hasRenderer(reg, "map")` | `lib/plugins.ts` |
| `CodeBlock.tsx` | One branch: `map`/`geojson` + enabled → `<MapView>` | `hasRenderer` |
| `store/threads.ts` | One block in `loadSharedSystemBlocks` pushing `buildMapsSystemText` | `lib/maps.ts` |
| `package.json` | Add `leaflet` + `@types/leaflet` | — |
| `src/lib/i18n.ts` | Strings (e.g. routing-fallback note, attribution already automatic) | — |

The plugin reads the **same host registry** as every other renderer, so the single
Settings → Plugins toggle governs both the renderer (`MapView`) and the auto-instruct
(`buildMapsSystemText`) together — no separate state.

## Auto-instruct (system text)

`buildMapsSystemText(reg)` returns `""` when the plugin is disabled (callers skip the system
message — chats unaffected). When enabled it teaches the model: emit a ` ```map ` fence
containing a GeoJSON FeatureCollection; Points are markers (`label`/`popup`/`category` in
`properties`); LineStrings are paths, and adding `properties.snap` of `"driving"`, `"walking"`,
or `"cycling"` snaps the waypoints to real roads; the app fits the view to the data
automatically; use maps when geography makes the answer clearer (locations, directions, trip
plans).

## Security posture

- **Exactly two hardcoded remote endpoints**: the OSM tile server (raster `<img>` tiles, which
  a map inherently requires) and the Valhalla routing server. The model's GeoJSON supplies only
  coordinates and text — it cannot redirect either request, and any URL-like fields are ignored.
  This is a deliberate, scoped exception to the `charts` "no remote fetch" rule (charts have no
  reason to fetch; a map cannot exist without tiles).
- **Popups render as text** (`textContent`, never HTML) — model-authored strings cannot inject
  markup/script into the Tauri webview.
- **Off by default** → zero network activity unless the user opts in.
- **Attribution**: Leaflet's attribution control shows "© OpenStreetMap contributors" (license
  requirement); kept on. The OSM tile usage policy is satisfied by low-volume personal use; the
  tile URL is a single constant, easy to repoint at another provider later.

## Testing

Mirrors `charts.test.ts` / `youtube.test.ts`:

- `src/lib/maps.test.ts` — `buildMapsSystemText` returns `""` when disabled and the instruction
  text when the `map` renderer is enabled.
- `src/lib/geo.test.ts` — `parseFeatureCollection` accepts valid FeatureCollections and rejects
  partial/invalid JSON (the streaming gate); `snap`→mode resolution; waypoint extraction from a
  LineString; bounds computation over mixed feature types.
- Rust unit test for `decode_polyline6` against a known Valhalla-style encoded string.

No CSP or capability changes (CSP is `null`; app commands are not capability-gated).

## Non-goals / deferred

- **Public transport routing.** Real transit means a different service — **Transitous/MOTIS**
  (`api.transitous.org`, also no key) — which returns timed multi-leg *itineraries* rather than
  a snap-to-road polyline, needs a different rendering treatment (itinerary panel + colored
  transit legs), and has partial global coverage (only where GTFS feeds exist). Valhalla's
  `multimodal` costing does not help — the public planet build carries no GTFS. Documented here
  as a clean follow-up; explicitly out of v1.
- **Interactive editing** — clicking/dragging to add waypoints, live re-routing, POI search
  (Nominatim/Overpass), itinerary panels. v1 is display-only / model-driven, like every
  existing renderer.
- **Fullscreen lightbox.** The inline map is already pan/zoom interactive; the existing lightbox
  helper is SVG-only and won't host a Leaflet DOM map. Out of scope for v1.
- **Vector/custom tile styles**, offline tile caching, marker clustering for huge feature sets.
