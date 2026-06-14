import { invoke } from "@tauri-apps/api/core";
import type { MessageImage } from "@/lib/messages";

/** File extension for a stored image's media type (`image/jpeg` → `jpg`). */
function extFromMediaType(mediaType: string): string {
  const sub = (mediaType.split("/")[1] ?? "").toLowerCase();
  if (sub === "jpeg" || sub === "jpg") return "jpg";
  const clean = sub.replace(/[^a-z0-9]/g, "");
  return clean || "png";
}

/**
 * Save a chat image to disk via the native "Save as…" dialog (Rust
 * `save_image`). The bytes are written backend-side from the base64 payload —
 * the webview never touches the filesystem. Resolves `true` if written,
 * `false` if the user cancelled the dialog.
 */
export async function downloadImage(image: MessageImage): Promise<boolean> {
  const suggestedName = `snak-image.${extFromMediaType(image.media_type)}`;
  return invoke<boolean>("save_image", { data: image.data, suggestedName });
}

/** UTF-8-safe base64 (`btoa` is latin1-only; SVG text labels are Unicode). */
function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Save a rendered Mermaid (or any) SVG diagram as a `.svg` file (T44). When
 * `bg` is given the background is baked into the saved file (T54) so the
 * standalone `.svg` isn't transparent in external viewers.
 */
export async function downloadSvg(svg: string, bg?: string): Promise<boolean> {
  return invoke<boolean>("save_image", {
    data: utf8ToBase64(bg ? withSvgBackground(svg, bg) : svg),
    suggestedName: "snak-diagram.svg",
  });
}

/**
 * Insert an opaque background `<rect>` as the first child of the root `<svg>`
 * (T54). Mermaid emits no background, so an enlarged/downloaded diagram is
 * otherwise transparent. The rect covers the `viewBox` (falling back to the
 * full viewport) and is painted before everything else. Returns the input
 * unchanged on any parse failure.
 */
export function withSvgBackground(svg: string, bg: string): string {
  try {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const el = doc.documentElement;
    if (el.nodeName.toLowerCase() !== "svg") return svg;
    const SVG_NS = "http://www.w3.org/2000/svg";
    const rect = doc.createElementNS(SVG_NS, "rect");
    const viewBox = el.getAttribute("viewBox");
    const parts = viewBox?.trim().split(/[\s,]+/).map(Number);
    if (parts && parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      rect.setAttribute("x", String(parts[0]));
      rect.setAttribute("y", String(parts[1]));
      rect.setAttribute("width", String(parts[2]));
      rect.setAttribute("height", String(parts[3]));
    } else {
      rect.setAttribute("x", "0");
      rect.setAttribute("y", "0");
      rect.setAttribute("width", "100%");
      rect.setAttribute("height", "100%");
    }
    rect.setAttribute("fill", bg);
    el.insertBefore(rect, el.firstChild);
    return el.outerHTML;
  } catch {
    return svg;
  }
}

/**
 * Normalise a Mermaid SVG so it scales to fill its container in the lightbox.
 * Mermaid caps the diagram with an inline `max-width` and a fixed `width`; we
 * drop those and let the `viewBox` drive aspect-ratio-preserving scaling, so a
 * small diagram blows up to fit the viewport instead of staying tiny. When
 * `bg` is given an opaque background rect is baked in too (T54).
 */
export function fitSvg(svg: string, bg?: string): string {
  try {
    const source = bg ? withSvgBackground(svg, bg) : svg;
    const doc = new DOMParser().parseFromString(source, "image/svg+xml");
    const el = doc.documentElement;
    if (el.nodeName.toLowerCase() !== "svg") return source;
    el.setAttribute("width", "100%");
    el.setAttribute("height", "100%");
    el.setAttribute("preserveAspectRatio", "xMidYMid meet");
    el.style.maxWidth = "none";
    return el.outerHTML;
  } catch {
    return svg;
  }
}
