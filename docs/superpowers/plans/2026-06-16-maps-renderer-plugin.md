# OpenStreetMap Renderer Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a built-in, disabled-by-default renderer plugin (`com.snak.maps`) that turns a ` ```map ` / ` ```geojson ` fenced GeoJSON FeatureCollection into an interactive OpenStreetMap map with markers, areas, and road-snapped routes — no API key.

**Architecture:** Mirrors the existing `com.snak.charts` renderer. A Rust built-in manifest declares the plugin; `CodeBlock` renders a lazy Leaflet `MapView` when the plugin is enabled; a pure `geo.ts` parses/validates GeoJSON and resolves `snap`→routing profile; a Rust `route_directions` command snaps waypoints to roads via the free FOSSGIS Valhalla server and returns decoded `[lng,lat]` geometry; `buildMapsSystemText` teaches the model the fence when enabled. Disabled → plain code block, no system text (byte-identical to today).

**Tech Stack:** TypeScript + React 19, Leaflet 1.9 (lazy), Tailwind v4; Rust (Tauri command, `reqwest`); Vitest + `cargo test`.

**Spec:** `docs/superpowers/specs/2026-06-16-maps-renderer-plugin-design.md`

---

## File structure

| File | Responsibility | Task |
| --- | --- | --- |
| `package.json` | Add `leaflet` + `@types/leaflet` | 1 |
| `src/lib/geo.ts` | Pure: parse FeatureCollection, resolve `snap`→profile, extract LineString waypoints | 2 |
| `src/lib/geo.test.ts` | Unit tests for `geo.ts` | 2 |
| `src/lib/maps.ts` | `buildMapsSystemText(reg)` auto-instruct (gated) | 3 |
| `src/lib/maps.test.ts` | Unit tests for `maps.ts` | 3 |
| `src-tauri/src/commands/routing.rs` | `route_directions` command + `decode_polyline6` (+ Rust tests) | 4 |
| `src-tauri/src/commands/mod.rs` | Declare `pub mod routing;` | 4 |
| `src-tauri/src/lib.rs` | Register `route_directions` in `generate_handler!` | 4 |
| `src/lib/routing.ts` | Frontend wrapper over `route_directions` | 5 |
| `src-tauri/src/plugins/builtin/maps.json` | Plugin manifest (renderer, off by default) | 6 |
| `src-tauri/src/plugins/mod.rs` | Add `include_str!` + update builtins test | 6 |
| `src/components/chat/MapView.tsx` | Lazy Leaflet renderer (parse gate, route snapping, theming, text popups) | 7 |
| `src/index.css` | Dark-mode tile filter | 8 |
| `src/lib/i18n.ts` | `chat.mapLabel` string | 8 |
| `src/components/chat/CodeBlock.tsx` | Branch: `map`/`geojson` + enabled → `<MapView>` | 9 |
| `src/store/threads.ts` | Push `buildMapsSystemText` into shared system blocks | 10 |

---

## Task 1: Add Leaflet dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Leaflet + types**

Run (from repo root):
```bash
npm install leaflet@^1.9.4
npm install -D @types/leaflet@^1.9.21
```

- [ ] **Step 2: Verify install**

Run: `node -p "require('leaflet/package.json').version"`
Expected: `1.9.4`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add leaflet dependency for maps renderer plugin"
```

---

## Task 2: `geo.ts` — pure GeoJSON helpers (TDD)

**Files:**
- Create: `src/lib/geo.ts`
- Test: `src/lib/geo.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/geo.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  parseFeatureCollection,
  resolveProfile,
  lineWaypoints,
  type GeoFeature,
} from "@/lib/geo";

describe("parseFeatureCollection", () => {
  it("parses a valid FeatureCollection", () => {
    const fc = parseFeatureCollection(
      '{"type":"FeatureCollection","features":[]}',
    );
    expect(fc).not.toBeNull();
    expect(fc?.features).toEqual([]);
  });

  it("returns null for partial JSON (streaming gate)", () => {
    expect(parseFeatureCollection('{"type":"FeatureColl')).toBeNull();
  });

  it("returns null for non-FeatureCollection objects", () => {
    expect(parseFeatureCollection('{"type":"Feature"}')).toBeNull();
    expect(parseFeatureCollection("42")).toBeNull();
  });
});

describe("resolveProfile", () => {
  it("maps snap aliases to Valhalla costing", () => {
    expect(resolveProfile(true)).toBe("auto");
    expect(resolveProfile("driving")).toBe("auto");
    expect(resolveProfile("walking")).toBe("pedestrian");
    expect(resolveProfile("cycling")).toBe("bicycle");
    expect(resolveProfile("WALKING")).toBe("pedestrian");
  });

  it("returns null when no snapping is requested or value is unknown", () => {
    expect(resolveProfile(undefined)).toBeNull();
    expect(resolveProfile(false)).toBeNull();
    expect(resolveProfile("bus")).toBeNull();
  });
});

describe("lineWaypoints", () => {
  const line = (coords: unknown): GeoFeature => ({
    type: "Feature",
    geometry: { type: "LineString", coordinates: coords },
    properties: null,
  });

  it("returns the positions of a LineString with >=2 points", () => {
    expect(lineWaypoints(line([[1, 2], [3, 4]]))).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("returns null for a single-point line or a non-LineString", () => {
    expect(lineWaypoints(line([[1, 2]]))).toBeNull();
    expect(
      lineWaypoints({
        type: "Feature",
        geometry: { type: "Point", coordinates: [1, 2] },
        properties: null,
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/geo.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/geo"`.

- [ ] **Step 3: Implement `geo.ts`**

Create `src/lib/geo.ts`:
```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/geo.test.ts`
Expected: PASS (3 suites, 7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/geo.ts src/lib/geo.test.ts
git commit -m "feat(maps): pure GeoJSON parse/profile/waypoint helpers"
```

---

## Task 3: `maps.ts` — auto-instruct system text (TDD)

**Files:**
- Create: `src/lib/maps.ts`
- Test: `src/lib/maps.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/maps.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildMapsSystemText } from "@/lib/maps";
import type { HostRegistry } from "@/lib/plugins";

const registry = (languages: string[]): HostRegistry => ({
  providers: [],
  themes: [],
  skills: [],
  slashCommands: [],
  renderers: languages.map((language) => ({ language })),
});

describe("buildMapsSystemText", () => {
  it("returns empty string when the maps renderer is disabled", () => {
    expect(buildMapsSystemText(registry([]))).toBe("");
    expect(buildMapsSystemText(registry(["mermaid"]))).toBe("");
  });

  it("returns the map instruction when the map renderer is enabled", () => {
    const out = buildMapsSystemText(registry(["map"]));
    expect(out).toContain("## Maps");
    expect(out).toContain("`map`");
    expect(out).toContain("snap");
  });

  it("matches the renderer language case-insensitively", () => {
    expect(buildMapsSystemText(registry(["Map"]))).toContain("## Maps");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/maps.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/maps"`.

- [ ] **Step 3: Implement `maps.ts`**

Create `src/lib/maps.ts`:
```ts
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
      "Polygon features are filled areas. Coordinates are [longitude, latitude] " +
      "and the app fits the view to your data automatically. Use a map when " +
      "geography (locations, directions, a trip plan) makes the answer clearer " +
      "than text.",
  ].join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/maps.test.ts`
Expected: PASS (1 suite, 3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/maps.ts src/lib/maps.test.ts
git commit -m "feat(maps): auto-instruct system text gated on the map renderer"
```

---

## Task 4: Rust `route_directions` command + polyline decode (TDD)

**Files:**
- Create: `src-tauri/src/commands/routing.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs:332` (add to `generate_handler!`)

- [ ] **Step 1: Write `routing.rs` with the decoder tests**

Create `src-tauri/src/commands/routing.rs`:
```rust
//! Road routing for the maps renderer plugin (com.snak.maps).
//!
//! Calls the FOSSGIS-hosted Valhalla demo server (free, no API key) to snap a
//! sequence of waypoints to real roads, returning the route geometry as
//! [lng, lat] positions ready to drop into a GeoJSON LineString. Routing runs
//! here (not the webview) to avoid CORS, send a fair-use `User-Agent`, and keep
//! outbound calls in Rust per the project architecture. The frontend falls back
//! to the straight-line waypoints on any error, so a route always renders.

use std::time::Duration;

const VALHALLA_URL: &str = "https://valhalla1.openstreetmap.de/route";
const TIMEOUT: Duration = Duration::from_secs(12);

#[derive(serde::Serialize)]
struct Location {
    lat: f64,
    lon: f64,
}

#[derive(serde::Serialize)]
struct RouteRequest {
    locations: Vec<Location>,
    costing: String,
    directions_type: &'static str,
}

#[derive(serde::Deserialize)]
struct RouteResponse {
    trip: Option<Trip>,
}

#[derive(serde::Deserialize)]
struct Trip {
    legs: Vec<Leg>,
}

#[derive(serde::Deserialize)]
struct Leg {
    shape: String,
}

/// Snap `waypoints` ([lng, lat]) to roads using Valhalla `profile`
/// (auto/pedestrian/bicycle; anything else falls back to auto). Returns the
/// route geometry as [lng, lat] positions. Any error (network, no route, bad
/// input) is returned as `Err` — the caller draws the raw waypoints instead.
#[tauri::command]
pub async fn route_directions(
    waypoints: Vec<[f64; 2]>,
    profile: String,
) -> Result<Vec<[f64; 2]>, String> {
    if waypoints.len() < 2 {
        return Err("need at least two waypoints".into());
    }
    let costing = match profile.as_str() {
        "auto" | "pedestrian" | "bicycle" => profile,
        _ => "auto".to_string(),
    };
    let body = RouteRequest {
        locations: waypoints
            .iter()
            .map(|p| Location { lat: p[1], lon: p[0] })
            .collect(),
        costing,
        directions_type: "none",
    };
    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .user_agent(concat!("snak/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(VALHALLA_URL)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("routing server returned {}", resp.status()));
    }
    let parsed: RouteResponse = resp.json().await.map_err(|e| e.to_string())?;
    let trip = parsed.trip.ok_or("no route returned")?;
    let mut coords: Vec<[f64; 2]> = Vec::new();
    for (i, leg) in trip.legs.iter().enumerate() {
        let decoded = decode_polyline6(&leg.shape);
        // The first point of each leg after the first duplicates the previous
        // leg's last point, so skip it.
        let start = if i == 0 { 0 } else { 1 };
        if start < decoded.len() {
            coords.extend_from_slice(&decoded[start..]);
        }
    }
    if coords.len() < 2 {
        return Err("route geometry empty".into());
    }
    Ok(coords)
}

/// Decode a Google-encoded polyline at precision 6 (Valhalla's leg `shape`) into
/// [lng, lat] positions (GeoJSON coordinate order).
fn decode_polyline6(encoded: &str) -> Vec<[f64; 2]> {
    let bytes = encoded.as_bytes();
    let mut coords = Vec::new();
    let mut i = 0usize;
    let mut lat: i64 = 0;
    let mut lng: i64 = 0;
    let read = |i: &mut usize| -> i64 {
        let mut shift = 0;
        let mut result: i64 = 0;
        loop {
            if *i >= bytes.len() {
                break;
            }
            let b = (bytes[*i] as i64) - 63;
            *i += 1;
            result |= (b & 0x1f) << shift;
            shift += 5;
            if b < 0x20 {
                break;
            }
        }
        if result & 1 != 0 {
            !(result >> 1)
        } else {
            result >> 1
        }
    };
    while i < bytes.len() {
        lat += read(&mut i);
        lng += read(&mut i);
        coords.push([lng as f64 / 1e6, lat as f64 / 1e6]);
    }
    coords
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9, "{a} != {b}");
    }

    #[test]
    fn decodes_positive_deltas() {
        // "AA" encodes a single (+1,+1) delta at precision 6; "AAAA" → two points.
        let pts = decode_polyline6("AAAA");
        assert_eq!(pts.len(), 2);
        approx(pts[0][0], 0.000001);
        approx(pts[0][1], 0.000001);
        approx(pts[1][0], 0.000002);
        approx(pts[1][1], 0.000002);
    }

    #[test]
    fn decodes_negative_deltas() {
        let pts = decode_polyline6("@@");
        assert_eq!(pts.len(), 1);
        approx(pts[0][0], -0.000001);
        approx(pts[0][1], -0.000001);
    }
}
```

- [ ] **Step 2: Declare the module**

In `src-tauri/src/commands/mod.rs`, add the line (keep alphabetical):
```rust
pub mod routing;
```
(after `pub mod quick;`)

- [ ] **Step 3: Run the decoder tests to verify they pass**

Run (from `src-tauri/`): `cargo test --lib routing`
Expected: PASS — `decodes_positive_deltas`, `decodes_negative_deltas`.

- [ ] **Step 4: Register the command**

In `src-tauri/src/lib.rs`, inside `tauri::generate_handler![ ... ]` (the block starting at line ~307), add after the last `commands::ollama::*` line:
```rust
            commands::routing::route_directions,
```

- [ ] **Step 5: Verify the backend compiles**

Run (from `src-tauri/`): `cargo build`
Expected: builds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/routing.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(maps): route_directions command (Valhalla) + polyline6 decode"
```

---

## Task 5: `routing.ts` — frontend command wrapper

**Files:**
- Create: `src/lib/routing.ts`

- [ ] **Step 1: Implement the wrapper**

Create `src/lib/routing.ts`:
```ts
// Frontend wrapper over the Rust `route_directions` command (maps plugin).
// Snaps waypoints to roads via the FOSSGIS Valhalla server; rejects on failure
// so the caller (MapView) can fall back to the straight-line waypoints.

import { invoke } from "@tauri-apps/api/core";
import type { Position, RouteProfile } from "@/lib/geo";

/** Snap `waypoints` ([lng,lat]) to roads, returning the route geometry as
 * [lng,lat] positions. Throws on any routing failure. */
export function routeDirections(
  waypoints: Position[],
  profile: RouteProfile,
): Promise<Position[]> {
  return invoke<Position[]>("route_directions", { waypoints, profile });
}
```

- [ ] **Step 2: Verify it typechecks**

Run (from repo root): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/routing.ts
git commit -m "feat(maps): frontend wrapper for the route_directions command"
```

---

## Task 6: Built-in manifest + registration

**Files:**
- Create: `src-tauri/src/plugins/builtin/maps.json`
- Modify: `src-tauri/src/plugins/mod.rs:127` (add `include_str!`) and the builtins test (line ~322)

- [ ] **Step 1: Create the manifest**

Create `src-tauri/src/plugins/builtin/maps.json`:
```json
{
  "id": "com.snak.maps",
  "name": "Maps",
  "version": "1.0.0",
  "category": "renderer",
  "apiVersion": 1,
  "description": "Renders ```map (and ```geojson) fenced code blocks as interactive OpenStreetMap maps with markers and road-snapped routes. No API key. Disabled by default; disable to show the raw GeoJSON instead.",
  "author": "snak",
  "enabledByDefault": false,
  "contributes": {
    "language": "map"
  }
}
```

- [ ] **Step 2: Register the manifest in `builtin_manifests()`**

In `src-tauri/src/plugins/mod.rs`, add to the `include_str!` array (after the `artifacts.json` line, ~line 127):
```rust
        include_str!("builtin/maps.json"),
```

- [ ] **Step 3: Update the builtins test for the disabled-by-default plugin**

In `src-tauri/src/plugins/mod.rs`, the test `all_builtins_are_valid_and_enabled_by_default` (line ~322) asserts a count of 10 and that **every** builtin is enabled by default. Maps is the first disabled-by-default builtin, so replace the body up to the `/terminal` assertion with:
```rust
        let builtins = builtin_manifests();
        // Five provider plugins (T18/T37) + the /terminal slash-command plugin
        // (T14) + five renderer plugins: mermaid (T42), charts, youtube,
        // artifacts, and maps (disabled by default).
        assert_eq!(builtins.len(), 11, "expected 11 built-in plugins");
        let providers = builtins.iter().filter(|m| m.category == "provider").count();
        assert_eq!(providers, 5, "expected 5 built-in providers");
        for m in &builtins {
            validate_manifest(m).expect("built-in must validate");
            if m.id == "com.snak.maps" {
                assert!(!m.enabled_by_default, "maps defaults disabled");
            } else {
                assert!(m.enabled_by_default, "other built-ins default enabled");
            }
        }
        // The maps renderer built-in is present, contributes the map language,
        // and is disabled by default.
        assert!(
            builtins.iter().any(|m| m.category == "renderer"
                && m.id == "com.snak.maps"
                && !m.enabled_by_default),
            "expected the built-in maps renderer plugin (disabled by default)",
        );
```
(Leave the existing `/terminal` and `mermaid` assertions that follow it unchanged.)

- [ ] **Step 4: Run the plugins tests**

Run (from `src-tauri/`): `cargo test --lib plugins`
Expected: PASS — including `all_builtins_are_valid_and_enabled_by_default`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/plugins/builtin/maps.json src-tauri/src/plugins/mod.rs
git commit -m "feat(maps): register com.snak.maps built-in renderer (off by default)"
```

---

## Task 7: `MapView.tsx` — Leaflet renderer component

**Files:**
- Create: `src/components/chat/MapView.tsx`

- [ ] **Step 1: Implement the component**

Create `src/components/chat/MapView.tsx`:
```tsx
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
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
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
  }, [parsed, resolved]);

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
```

- [ ] **Step 2: Verify it typechecks**

Run (from repo root): `npx tsc --noEmit`
Expected: no errors. (If `GeoJSON` namespace is unresolved, confirm `@types/leaflet` pulled in `@types/geojson`: `node -p "require('@types/geojson/package.json').version"`.)

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/MapView.tsx
git commit -m "feat(maps): lazy Leaflet MapView with route snapping and text popups"
```

---

## Task 8: Dark-mode tile filter + i18n string

**Files:**
- Modify: `src/index.css`
- Modify: `src/lib/i18n.ts` (the `en` dictionary, near the other `chat.*` keys ~line 197)

- [ ] **Step 1: Add the dark-mode tile filter to `index.css`**

Append to `src/index.css`:
```css
/* Maps renderer (com.snak.maps): tint the raster basemap toward dark mode so it
   reads against the dark theme. Applied via the .snak-map-dark class MapView
   adds when the app is in dark mode; only the tile layer is filtered so markers,
   routes, and popups keep their colors. */
.snak-map-dark .leaflet-tile-pane {
  filter: invert(1) hue-rotate(180deg) brightness(0.95) contrast(0.9);
}
```

- [ ] **Step 2: Add the i18n string**

In `src/lib/i18n.ts`, in the `en` object next to `"chat.viewChart"` (~line 197), add:
```ts
  "chat.mapLabel": "Map",
```

- [ ] **Step 3: Verify typecheck (MessageKey now includes the new key)**

Run (from repo root): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/index.css src/lib/i18n.ts
git commit -m "feat(maps): dark-mode tile filter and map aria-label string"
```

---

## Task 9: Wire `MapView` into `CodeBlock`

**Files:**
- Modify: `src/components/chat/CodeBlock.tsx` (import + branch after the vega block, ~line 82)

- [ ] **Step 1: Import `MapView`**

In `src/components/chat/CodeBlock.tsx`, add near the other component imports (after the `VegaChart` import, line 8):
```tsx
import { MapView } from "@/components/chat/MapView";
```

- [ ] **Step 2: Add the render branch**

In `CodeBlock`, immediately after the Vega-Lite `if (...) { return <VegaChart .../> }` block (ends ~line 82) and before `const onCopy`, add:
```tsx
  // Maps (com.snak.maps): a ```map or ```geojson fence becomes an interactive
  // OpenStreetMap map when the plugin is enabled (raw source otherwise).
  if (
    language &&
    (language.toLowerCase() === "map" ||
      language.toLowerCase() === "geojson") &&
    hasRenderer(registry, "map")
  ) {
    return <MapView code={text} />;
  }
```

- [ ] **Step 3: Verify typecheck + lint**

Run (from repo root): `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/CodeBlock.tsx
git commit -m "feat(maps): render map/geojson fences as maps when the plugin is on"
```

---

## Task 10: Wire `buildMapsSystemText` into the store

**Files:**
- Modify: `src/store/threads.ts` (import ~line 62; block in `loadSharedSystemBlocks` ~line 379)

- [ ] **Step 1: Import the builder**

In `src/store/threads.ts`, after the `buildChartsSystemText` import (line 63), add:
```ts
import { buildMapsSystemText } from "@/lib/maps";
```

- [ ] **Step 2: Push the system block**

In `loadSharedSystemBlocks`, after the artifacts block (the `if (artifactsSystemText) ...` ending ~line 379), add:
```ts
  // Maps auto-instruct (com.snak.maps): teach the model the ```map GeoJSON fence
  // when the maps renderer is enabled (empty otherwise).
  const mapsSystemText = buildMapsSystemText(registry);
  if (mapsSystemText)
    head.push({ role: "system", content: mapsSystemText, images: [] });
```

- [ ] **Step 3: Verify typecheck + lint**

Run (from repo root): `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/store/threads.ts
git commit -m "feat(maps): inject map fence instructions when the plugin is enabled"
```

---

## Task 11: Full verification (build, lint, tests, manual)

**Files:** none (verification only)

- [ ] **Step 1: Frontend tests**

Run (from repo root): `npm run test`
Expected: PASS, including `geo.test.ts` and `maps.test.ts`.

- [ ] **Step 2: Frontend build (typecheck + production bundle)**

Run (from repo root): `npm run build`
Expected: `tsc` passes and Vite builds. Leaflet should appear in a **separate async chunk** (lazy import), not the main bundle.

- [ ] **Step 3: Frontend lint**

Run (from repo root): `npm run lint`
Expected: no errors.

- [ ] **Step 4: Backend checks**

Run (from `src-tauri/`): `cargo test && cargo clippy && cargo fmt --check`
Expected: tests pass, clippy clean, formatting clean.

- [ ] **Step 5: Manual smoke test**

Run (from repo root): `npm run tauri dev`. Then:
1. Settings → Plugins → renderer group: confirm **Maps** appears and its toggle is **off** by default. Enable it.
2. In a chat, send an assistant message containing this fenced block (paste it yourself if needed):
   ````
   ```map
   {"type":"FeatureCollection","features":[
     {"type":"Feature","geometry":{"type":"Point","coordinates":[2.2945,48.8584]},"properties":{"label":"Eiffel Tower","popup":"Champ de Mars","category":"sight"}},
     {"type":"Feature","geometry":{"type":"Point","coordinates":[2.3376,48.8606]},"properties":{"label":"Louvre"}},
     {"type":"Feature","geometry":{"type":"LineString","coordinates":[[2.2945,48.8584],[2.3376,48.8606]]},"properties":{"snap":"walking","label":"Walk to the Louvre"}}
   ]}
   ```
   ````
   Expect: a map centered on Paris, two circle markers (click → text popups), and a **road-snapped** walking line (curves along streets, not a straight diagonal).
3. Toggle dark mode (ThemeToggle): the basemap tiles darken; markers/route keep their colors.
4. Disable the Maps plugin in Settings: the same block now renders as a **plain code block** (raw GeoJSON).
5. (Offline/failure check) Temporarily disable networking and resend: the route falls back to a **straight line** between waypoints and markers still render.

- [ ] **Step 6: Final commit (if any fmt/lint fixes were applied)**

```bash
git add -A
git commit -m "chore(maps): formatting and lint fixes"
```

---

## Notes for the implementer

- **Pure GeoJSON, no custom top-level keys** — markers/routes/areas are standard `Point`/`LineString`/`Polygon` features; everything extra (`label`, `popup`, `category`, `color`, `snap`) lives in `properties`.
- **The streaming gate is `JSON.parse`** — a partial FeatureCollection never parses (its closing braces haven't arrived), so routing only fires once, on the complete object. Do not add a separate "is complete" check.
- **Two hardcoded remote endpoints only** — OSM tiles (`<img>` in the webview) and Valhalla (Rust). The model's GeoJSON supplies coordinates/text, never URLs; do not add any feature that fetches a model-supplied URL.
- **Public transport is deferred** (see the spec's Non-goals) — `snap` accepts only driving/walking/cycling.
- If `npm run build` reports Leaflet in the main bundle, confirm the import is `await import("leaflet")` (dynamic), not a top-level `import`.
