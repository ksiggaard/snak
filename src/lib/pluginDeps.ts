// Pure dependency logic for the runtime plugin system: dotted-version compare,
// install/enable validation, dependents lookup, and topological enable order.
// No IO — unit-tested in pluginDeps.test.ts.

import type { PluginDependency } from "@/types/plugins";

/** Minimal shape the dependency logic needs (a `PluginManifest` satisfies it). */
export interface DepNode {
  id: string;
  version: string;
  dependencies?: PluginDependency[];
}

/**
 * Compare two dotted version strings numerically (e.g. "1.10.0" > "1.9.0").
 * Missing/non-numeric parts count as 0. Lazy: this is a "is X at least Y" check,
 * not a full semver range resolver (deliberately out of scope).
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = parseInt(pa[i] ?? "0", 10) || 0;
    const y = parseInt(pb[i] ?? "0", 10) || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** Whether `installed` satisfies an optional minimum version. */
export function satisfiesMin(installed: string, min?: string): boolean {
  if (!min) return true;
  return compareVersions(installed, min) >= 0;
}

export interface MissingDep {
  id: string;
  minVersion?: string;
  /** "missing" = not installed at all; "version" = installed but too old. */
  reason: "missing" | "version";
  installedVersion?: string;
}

/** Which of a plugin's declared dependencies are unmet by the installed set. */
export function missingDependencies(
  plugin: DepNode,
  installed: DepNode[],
): MissingDep[] {
  const byId = new Map(installed.map((p) => [p.id, p]));
  const out: MissingDep[] = [];
  for (const dep of plugin.dependencies ?? []) {
    const have = byId.get(dep.id);
    if (!have) {
      out.push({ id: dep.id, minVersion: dep.minVersion, reason: "missing" });
    } else if (!satisfiesMin(have.version, dep.minVersion)) {
      out.push({
        id: dep.id,
        minVersion: dep.minVersion,
        reason: "version",
        installedVersion: have.version,
      });
    }
  }
  return out;
}

/** A plugin's dependency ids that are not in the enabled set (block enabling). */
export function disabledDependencies(
  plugin: DepNode,
  enabledIds: Set<string>,
): string[] {
  return (plugin.dependencies ?? [])
    .map((d) => d.id)
    .filter((id) => !enabledIds.has(id));
}

/** Ids of plugins (from `among`) that declare a dependency on `id` — i.e. the
 * plugins a disable/uninstall of `id` would break. */
export function dependents(id: string, among: DepNode[]): string[] {
  return among
    .filter((p) => (p.dependencies ?? []).some((d) => d.id === id))
    .map((p) => p.id);
}

/**
 * Topologically sort so every plugin comes after the dependencies it declares.
 * Dependencies on ids not present in `items` are ignored (validated elsewhere).
 * Stable among independent nodes (preserves input order). Throws on a cycle.
 */
export function topoSort<T extends DepNode>(items: T[]): T[] {
  const byId = new Map(items.map((p) => [p.id, p]));
  const state = new Map<string, "visiting" | "done">();
  const out: T[] = [];

  const visit = (p: T, stack: string[]) => {
    const s = state.get(p.id);
    if (s === "done") return;
    if (s === "visiting") {
      throw new Error(
        `plugin dependency cycle: ${[...stack, p.id].join(" → ")}`,
      );
    }
    state.set(p.id, "visiting");
    for (const dep of p.dependencies ?? []) {
      const d = byId.get(dep.id);
      if (d) visit(d, [...stack, p.id]);
    }
    state.set(p.id, "done");
    out.push(p);
  };

  for (const p of items) visit(p, []);
  return out;
}
