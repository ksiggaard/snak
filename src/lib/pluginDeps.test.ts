import { describe, it, expect } from "vitest";
import {
  compareVersions,
  satisfiesMin,
  missingDependencies,
  disabledDependencies,
  dependents,
  topoSort,
  type DepNode,
} from "@/lib/pluginDeps";

const node = (
  id: string,
  version: string,
  deps?: { id: string; minVersion?: string }[],
): DepNode => ({ id, version, dependencies: deps });

describe("compareVersions", () => {
  it("compares numerically, not lexically", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("2.0", "2.0.1")).toBeLessThan(0);
  });
  it("treats missing/odd parts as 0", () => {
    expect(compareVersions("1", "1.0.0")).toBe(0);
    expect(compareVersions("1.x", "1.0")).toBe(0);
  });
});

describe("satisfiesMin", () => {
  it("is true with no minimum", () => {
    expect(satisfiesMin("0.1.0")).toBe(true);
  });
  it("requires installed >= min", () => {
    expect(satisfiesMin("1.2.0", "1.2.0")).toBe(true);
    expect(satisfiesMin("1.3.0", "1.2.0")).toBe(true);
    expect(satisfiesMin("1.1.0", "1.2.0")).toBe(false);
  });
});

describe("missingDependencies", () => {
  it("flags absent and too-old deps", () => {
    const plugin = node("a", "1.0.0", [
      { id: "b" },
      { id: "c", minVersion: "2.0.0" },
      { id: "d", minVersion: "1.0.0" },
    ]);
    const installed = [node("c", "1.5.0"), node("d", "1.0.0")];
    const missing = missingDependencies(plugin, installed);
    expect(missing).toEqual([
      { id: "b", minVersion: undefined, reason: "missing" },
      { id: "c", minVersion: "2.0.0", reason: "version", installedVersion: "1.5.0" },
    ]);
  });
});

describe("disabledDependencies", () => {
  it("returns dep ids not in the enabled set", () => {
    const plugin = node("a", "1.0.0", [{ id: "b" }, { id: "c" }]);
    expect(disabledDependencies(plugin, new Set(["b"]))).toEqual(["c"]);
  });
});

describe("dependents", () => {
  it("finds plugins that depend on an id", () => {
    const all = [
      node("a", "1.0.0", [{ id: "lib" }]),
      node("b", "1.0.0"),
      node("c", "1.0.0", [{ id: "lib" }]),
    ];
    expect(dependents("lib", all).sort()).toEqual(["a", "c"]);
  });
});

describe("topoSort", () => {
  it("orders dependencies before dependents", () => {
    const items = [
      node("app", "1.0.0", [{ id: "lib" }]),
      node("lib", "1.0.0", [{ id: "core" }]),
      node("core", "1.0.0"),
    ];
    const order = topoSort(items).map((p) => p.id);
    expect(order.indexOf("core")).toBeLessThan(order.indexOf("lib"));
    expect(order.indexOf("lib")).toBeLessThan(order.indexOf("app"));
  });

  it("ignores dependencies on absent ids", () => {
    const items = [node("a", "1.0.0", [{ id: "not-installed" }])];
    expect(topoSort(items).map((p) => p.id)).toEqual(["a"]);
  });

  it("throws on a cycle", () => {
    const items = [
      node("a", "1.0.0", [{ id: "b" }]),
      node("b", "1.0.0", [{ id: "a" }]),
    ];
    expect(() => topoSort(items)).toThrow(/cycle/);
  });

  it("is stable among independent nodes", () => {
    const items = [node("x", "1.0.0"), node("y", "1.0.0"), node("z", "1.0.0")];
    expect(topoSort(items).map((p) => p.id)).toEqual(["x", "y", "z"]);
  });
});
