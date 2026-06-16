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
