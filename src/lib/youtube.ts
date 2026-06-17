// YouTube embeds (com.snak.youtube).
//
// Detects YouTube links in assistant Markdown and (when the plugin is enabled)
// renders an inline click-to-play player, while keeping the link clickable.
// Parsing is a pure function so it can be unit-tested in isolation; the player
// component (`src/components/chat/YouTubeEmbed.tsx`) and the link detection in
// `Markdown.tsx` consume it.
//
// Also exports the transcript-fetch wrapper (T60) and the workspace markdown
// assembler used by WorkspaceView.

import { invoke } from "@tauri-apps/api/core";
import { hasRenderer, type HostRegistry } from "@/lib/plugins";

export interface YouTubeRef {
  /** The 11-character video id. */
  id: string;
  /** Start offset in whole seconds, if the URL carried one (`t`/`start`). */
  start?: number;
}

/**
 * One selectable video in a player's picker (the active video plus the other
 * search-result options for the same query). `poster`/`title` come from the
 * matching tool-result thumbnail when available.
 */
export interface YouTubeVideoOption {
  id: string;
  /** Canonical watch URL (opened in the system browser). */
  href: string;
  /** Thumbnail data URL, if a matching tool-result image was found. */
  poster?: string;
  /** Result title, if known (streaming-only — not persisted). */
  title?: string;
  /** Persistent reference label ("Video A", "Video B", …), if assigned. */
  label?: string;
}

/** A tool-result image whose `source` is a YouTube watch URL is really a video
 * (search-result thumbnail), not a picture — so it's presented and referenced
 * as a video rather than an image. */
export function isYouTubeThumb(img: { source?: string }): boolean {
  return img.source != null && parseYouTubeUrl(img.source) != null;
}

/**
 * Split a message's images into real images and YouTube video thumbnails.
 * `videosEnabled` mirrors the youtube plugin: when off, nothing is treated as a
 * video (everything stays an image), so the UI/manifest behaviour matches.
 */
export function partitionVideoThumbs<T extends { source?: string }>(
  images: readonly T[],
  videosEnabled: boolean,
): { images: T[]; videoThumbs: T[] } {
  if (!videosEnabled) return { images: [...images], videoThumbs: [] };
  const imgs: T[] = [];
  const videoThumbs: T[] = [];
  for (const im of images) (isYouTubeThumb(im) ? videoThumbs : imgs).push(im);
  return { images: imgs, videoThumbs };
}

/**
 * Conversation-wide label offsets for images and videos, counted separately by
 * order of appearance (so "Image A/B…" and "Video A/B…" are independent stable
 * sequences). Mirrors `imageLabelOffsets` but partitions YouTube thumbnails out
 * into their own video sequence when `videosEnabled`.
 */
export function mediaLabelOffsets(
  messages: readonly { images?: { source?: string }[] }[],
  videosEnabled: boolean,
): { imageOffsets: number[]; videoOffsets: number[] } {
  const imageOffsets: number[] = [];
  const videoOffsets: number[] = [];
  let imgTotal = 0;
  let vidTotal = 0;
  for (const m of messages) {
    imageOffsets.push(imgTotal);
    videoOffsets.push(vidTotal);
    for (const im of m.images ?? []) {
      if (videosEnabled && isYouTubeThumb(im)) vidTotal++;
      else imgTotal++;
    }
  }
  return { imageOffsets, videoOffsets };
}

/** Canonical watch URL for a bare video id. */
export function watchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

const HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

/** Parse a `t`/`start` value: bare seconds ("90") or "1h2m3s" / "2m30s" / "45s". */
function parseStart(raw: string | null): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (!m || (!m[1] && !m[2] && !m[3])) return undefined;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  return h * 3600 + min * 60 + s;
}

/**
 * Extract a YouTube video reference from a URL, or null if it isn't a
 * recognizable YouTube video link. Handles watch, youtu.be, embed, shorts,
 * live, and `/v/` forms across the youtube.com / youtu.be / nocookie hosts.
 */
export function parseYouTubeUrl(href: string): YouTubeRef | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null;

  const start = parseStart(url.searchParams.get("t") ?? url.searchParams.get("start"));
  const segments = url.pathname.split("/").filter(Boolean);

  // youtu.be/<id>
  if (host.endsWith("youtu.be")) {
    const id = segments[0];
    return id && ID_RE.test(id) ? { id, start } : null;
  }

  // youtube.com/watch?v=<id>
  if (segments[0] === "watch" || segments.length === 0) {
    const id = url.searchParams.get("v");
    return id && ID_RE.test(id) ? { id, start } : null;
  }

  // youtube.com/{embed,shorts,live,v}/<id>
  if (["embed", "shorts", "live", "v"].includes(segments[0])) {
    const id = segments[1];
    return id && ID_RE.test(id) ? { id, start } : null;
  }

  return null;
}

/**
 * The video ids that will render as inline players in a Markdown string: the
 * ids of YouTube links that stand alone as their own paragraph (a bare URL or a
 * single `[text](url)`), matching `YouTubeParagraph`'s detection. Used by the
 * message renderer to drop the now-redundant standalone thumbnail (and reuse it
 * as the player's poster) for exactly those videos. Inline-in-prose links don't
 * become players, so their ids are not returned and their thumbnails are kept.
 */
export function embeddedYouTubeIds(content: string): string[] {
  const ids: string[] = [];
  for (const block of content.split(/\n\s*\n/)) {
    const text = block.trim();
    if (!text) continue;
    const mdLink = /^\[[^\]]*\]\((\S+)\)$/.exec(text);
    const url = mdLink ? mdLink[1] : /\s/.test(text) ? null : text;
    if (!url) continue;
    const ref = parseYouTubeUrl(url);
    if (ref) ids.push(ref.id);
  }
  return ids;
}

/** The youtube-nocookie embed URL for a parsed reference (autoplay on click). */
export function youTubeEmbedSrc(ref: YouTubeRef): string {
  const params = new URLSearchParams({ autoplay: "1", rel: "0" });
  if (ref.start) params.set("start", String(ref.start));
  return `https://www.youtube-nocookie.com/embed/${ref.id}?${params.toString()}`;
}

/**
 * System text telling the model it can embed YouTube videos. Returns "" when
 * the YouTube plugin is disabled (so chats are unaffected). Mirrors
 * `buildChartsSystemText`. The key instruction is to put a video URL on its own
 * line so the inline player can replace it — the link itself stays available.
 */
export function buildYouTubeSystemText(reg: HostRegistry): string {
  if (!hasRenderer(reg, "youtube")) return "";
  return [
    "## YouTube videos",
    "When you reference a YouTube video, put its URL on its own line (a " +
      "standalone paragraph, not inside a sentence). The app replaces such a " +
      "line with an inline, click-to-play player; the link itself stays " +
      "available. Do not invent video URLs — only link videos you are confident " +
      "exist.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// T60 — YouTube transcript fetch + workspace markdown assembly
// ---------------------------------------------------------------------------

/** Result returned by the `fetch_youtube_transcript` Rust command. */
export interface YoutubeTranscriptResult {
  title: string;
  transcript: string;
  no_captions: boolean;
}

/**
 * Fetch the closed-caption transcript of a YouTube video via the Rust command
 * `fetch_youtube_transcript`. Returns `{ title, transcript, no_captions }`.
 * Throws a user-readable string on network / parse errors.
 */
export function fetchYoutubeTranscript(
  url: string,
): Promise<YoutubeTranscriptResult> {
  return invoke<YoutubeTranscriptResult>("fetch_youtube_transcript", { url });
}

/**
 * System prompt used when summarizing a YouTube transcript. Kept here as a
 * named constant so it is easy to iterate on without touching component code.
 */
export const YOUTUBE_SUMMARY_SYSTEM_PROMPT =
  "You are a helpful assistant. The user will provide you with the timestamped " +
  "transcript of a YouTube video. Write a clear, well-structured summary in " +
  "Markdown covering the main points, key takeaways, and any important details. " +
  "Use headers and bullet points where they aid readability. Preserve noteworthy " +
  "timestamps (e.g. [mm:ss]) inline when they help the reader navigate the video.";

/**
 * Assemble the workspace markdown file for a YouTube video, following the T59
 * front-matter convention:
 *
 *   <!-- source: {url} -->
 *   <!-- fetched: YYYY-MM-DD -->
 *
 *   # {title}
 *
 *   {summary}
 *
 * Pure — no side effects — so it is unit-testable.
 */
export function buildYoutubeMarkdown(
  url: string,
  title: string,
  summary: string,
  date: string,
): string {
  const heading = title.trim() || "YouTube video";
  return (
    `<!-- source: ${url} -->\n` +
    `<!-- fetched: ${date} -->\n\n` +
    `# ${heading}\n\n` +
    summary.trim()
  );
}

/**
 * Derive a safe workspace filename for a YouTube video. Uses the video title
 * (sanitised) — the same logic used for web URLs in WorkspaceView.
 */
export function youtubeFileName(title: string, url: string): string {
  const hostname = url.replace(/^https?:\/\//, "").split(/[/?]/)[0] ?? "video";
  const baseName = title.trim() || hostname;
  const safe = baseName.replace(/[/\\:*?"<>|]/g, "-").slice(0, 80);
  return `${safe}.md`;
}
