// Internet reachability wrapper (offline mode): a thin wrapper over the Rust
// `connectivity_probe` command, mirroring `src/lib/ollama.ts`. The probe never
// rejects for "no internet" — that's a normal state, reported as
// `{ online: false }`.

import { invoke } from "@tauri-apps/api/core";

/** Internet reachability as reported by Rust `connectivity_probe`. */
export interface Connectivity {
  online: boolean;
}

/** Probe internet reachability. Resolves `{ online: false }` when offline. */
export const probeConnectivity = (): Promise<Connectivity> =>
  invoke("connectivity_probe");
