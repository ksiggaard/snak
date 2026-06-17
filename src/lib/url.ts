/**
 * T59 — Workspace URL ingestion helpers.
 *
 * The Rust command `fetch_url_as_markdown` fetches a URL, converts HTML to
 * condensed markdown, and returns `{ title, markdown }`. This module provides
 * the Tauri invoke wrapper and a pure URL validation helper that mirrors the
 * Rust-side check.
 */

import { invoke } from "@tauri-apps/api/core";

export interface FetchedPage {
  title: string;
  markdown: string;
}

/**
 * Fetch a URL and convert the page HTML to condensed, structure-preserving
 * markdown. Returns the page title (derived from `<title>` or the first `<h1>`,
 * falling back to the hostname) and the full markdown content (including a
 * front-matter header recording the source URL and fetch date).
 *
 * Throws a user-readable string on network or HTTP errors.
 */
export async function fetchUrlAsMarkdown(url: string): Promise<FetchedPage> {
  return invoke<FetchedPage>("fetch_url_as_markdown", { url });
}

/**
 * Lightweight URL validation. Returns an error message on failure, or `null`
 * when the URL looks valid. Mirrors the Rust-side `validate_url` check so
 * the frontend can give instant feedback before the async fetch.
 */
export function validateUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return "URL cannot be empty";
  if (/\s/.test(trimmed)) return "URL must not contain whitespace";
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return "URL must start with http:// or https://";
  }
  const withoutScheme = trimmed.replace(/^https?:\/\//, "");
  const host = withoutScheme.split(/[/?]/)[0] ?? "";
  if (!host) return "URL must have a non-empty host";
  return null;
}
