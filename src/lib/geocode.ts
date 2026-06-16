// Forward geocoding for the maps renderer (com.snak.maps): resolve a place name
// or street address to a [lng,lat] position via the Rust `geocode` command
// (Nominatim). The model names places by address instead of guessing
// coordinates, and the app resolves them precisely here.
//
// Two fair-use concerns are handled in this seam: results are cached per query
// for the session (so re-renders/streaming don't re-request), and requests are
// serialized ≥1s apart to respect Nominatim's "≤1 request/second" usage policy.

import { invoke } from "@tauri-apps/api/core";
import type { Position } from "@/lib/geo";

const cache = new Map<string, Promise<Position | null>>();
// Tail of the request chain; each new lookup waits for it, so calls never run
// concurrently and are spaced out by the fair-use gap below.
let tail: Promise<unknown> = Promise.resolve();

const GAP_MS = 1100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve `query` to a `[lng,lat]` position, or null if nothing matches.
 * Cached (including the in-flight promise, so duplicate queries share one
 * request) and serialized to honor the Nominatim fair-use policy. Rejections
 * are not cached, so a transient failure can be retried on a later render.
 */
export function geocode(query: string): Promise<Position | null> {
  const key = query.trim().toLowerCase();
  if (!key) return Promise.resolve(null);
  const existing = cache.get(key);
  if (existing) return existing;

  const result = tail.then(() =>
    invoke<Position | null>("geocode", { query }),
  );
  cache.set(key, result);
  result.catch(() => cache.delete(key)); // allow retry after a transient failure
  // Next lookup waits for this one plus a gap, whether it resolved or rejected.
  tail = result.then(
    () => sleep(GAP_MS),
    () => sleep(GAP_MS),
  );
  return result;
}
