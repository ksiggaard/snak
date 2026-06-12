// Ollama discovery helpers (T37): thin wrappers over the Rust probe commands
// plus the pure model-name validation / reconciliation logic (unit-tested).
// Chat itself goes through the normal `chat_stream` path — provider "ollama"
// is keyless, so no keychain machinery is involved (see lib/providers.ts).

import { invoke } from "@tauri-apps/api/core";
import type { Model } from "@/types/db";

/** Daemon health as reported by Rust `ollama_status`. */
export interface OllamaStatus {
  running: boolean;
  version: string | null;
}

/** One locally-installed model (Rust `OllamaModel`, from `/api/tags`). */
export interface OllamaModelInfo {
  name: string;
  /** On-disk size in bytes. */
  size: number;
  /** RFC 3339 timestamp of the last modification (pull/update). */
  modified_at: string;
}

/** Probe the local daemon. Never rejects for an unreachable daemon — that's a
 *  normal state and comes back as `{ running: false }`. */
export const getOllamaStatus = (): Promise<OllamaStatus> =>
  invoke("ollama_status");

/** List the locally-installed models (rejects when the daemon is down). */
export const listOllamaModels = (): Promise<OllamaModelInfo[]> =>
  invoke("ollama_list_models");

/**
 * Whether `name` is a plausible Ollama model name: dotted/dashed segments,
 * optional `/` path parts (hf.co/org/repo) and an optional `:tag`. Rejects
 * anything with whitespace or shell metacharacters — the name is interpolated
 * into the staged `ollama pull` command, so this is also the safety filter.
 */
export function isValidOllamaModelName(name: string): boolean {
  const segment = "[A-Za-z0-9][A-Za-z0-9._-]*";
  return new RegExp(`^${segment}(/${segment})*(:${segment})?$`).test(name);
}

/** The shell command staged (never auto-run) to pull a model. */
export function ollamaPullCommand(name: string): string {
  return `ollama pull ${name}`;
}

/**
 * Diff the configured `models` rows against the daemon's installed list.
 * Only `provider === "ollama"` rows are candidates for removal — other
 * providers' rows are never touched. `toAdd` is the installed names with no
 * ollama row yet (they get the name as both model id and label).
 */
export function reconcileOllamaModels(
  existing: Model[],
  installed: string[],
): { toAdd: string[]; toRemove: Model[] } {
  const rows = existing.filter((m) => m.provider === "ollama");
  const have = new Set(rows.map((m) => m.model_id));
  const want = new Set(installed);
  return {
    toAdd: installed.filter((name) => !have.has(name)),
    toRemove: rows.filter((m) => !want.has(m.model_id)),
  };
}

/** Human-readable byte size for the installed-models list, e.g. "1.3 GB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = "B";
  for (const next of units) {
    if (value < 1000) break;
    value /= 1000;
    unit = next;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${unit}`;
}
