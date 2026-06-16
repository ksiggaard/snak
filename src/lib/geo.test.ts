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
    expect(
      lineWaypoints(
        line([
          [1, 2],
          [3, 4],
        ]),
      ),
    ).toEqual([
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
