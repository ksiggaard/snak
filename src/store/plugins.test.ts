import { describe, expect, it } from "vitest";
import { selectRegistry } from "./plugins";
import type { PluginInfo } from "@/types/plugins";

type State = Parameters<typeof selectRegistry>[0];

const stateWith = (plugins: PluginInfo[]): State =>
  ({ plugins, loaded: true, error: null }) as unknown as State;

describe("selectRegistry", () => {
  // Regression: as a Zustand selector this runs every render. If it returns a
  // fresh object each call, useSyncExternalStore (Object.is equality) sees the
  // snapshot change every render → infinite re-render → "Maximum update depth
  // exceeded" (an all-black window, since the crash unmounts the whole tree).
  it("returns a stable reference when plugins are unchanged", () => {
    const s = stateWith([]);
    expect(selectRegistry(s)).toBe(selectRegistry(s));
  });

  it("returns a new reference after the plugins array changes", () => {
    const a = selectRegistry(stateWith([]));
    const b = selectRegistry(stateWith([]));
    // Different `plugins` array identity (a reload) → recomputed registry.
    expect(a).not.toBe(b);
  });
});
