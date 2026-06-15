// Artifacts (idea: Claude-style multi-file web apps).
//
// A model emits an artifact as a single fenced code block tagged `artifact`.
// Inside the block an optional `title:` header line is followed by one or more
// files, each introduced by a `--- <path> ---` delimiter line:
//
//   ```artifact
//   title: Todo App
//   --- index.html ---
//   <!doctype html>...
//   --- style.css ---
//   body { ... }
//   ```
//
// The fence *info string* (`artifact title="…"`) is intentionally NOT used to
// carry metadata: react-markdown only forwards the language to the rendered
// `<code>` element and drops the rest, so everything the parser needs lives in
// the block body. These helpers are pure (no React/DOM) so they unit-test in
// isolation — `parseArtifact`/`assembleArtifact`/`buildArtifactsSystemText`.

import { hasRenderer, type HostRegistry } from "@/lib/plugins";

/** One file inside an artifact: a relative path and its full text contents. */
export interface ArtifactFile {
  path: string;
  content: string;
}

/** A parsed artifact: a display title and its files (in declared order). */
export interface ParsedArtifact {
  title: string;
  files: ArtifactFile[];
}

/** The fence language the artifact renderer claims (see builtin manifest). */
export const ARTIFACT_LANGUAGE = "artifact";

/**
 * System text for the in-viewer AI editor: instruct the model to return the
 * COMPLETE updated artifact (full files, no diffs/placeholders) in the same
 * fenced format, so the response can wholesale-replace the current artifact.
 */
export const ARTIFACT_EDITOR_SYSTEM_PROMPT = [
  "You are editing an existing multi-file web artifact.",
  "Apply the user's requested change and return the COMPLETE updated artifact " +
    "as a single fenced code block tagged `artifact`.",
  "Rules:",
  "- Return every file in full — the result replaces the current artifact " +
    'entirely. Never abbreviate or use placeholders like "… unchanged …".',
  "- Keep the same format: an optional `title:` line, then each file " +
    "introduced by a `--- <path> ---` delimiter line.",
  "- Keep the entry point `index.html`; you may add, expand, or modify files.",
  "- Output only the artifact block — no explanation before or after it.",
].join("\n");

const DELIMITER = /^\s*---\s*(.+?)\s*---\s*$/;
const TITLE_LINE = /^\s*title\s*[:=]\s*(.+?)\s*$/i;

// File-type matchers and the media type used for inlined JS, shared across the
// assembly helpers (kept in one place rather than repeated inline).
const JS_FILE = /\.m?js$/i;
const CSS_FILE = /\.css$/i;
const HTML_FILE = /\.html$/i;
const INDEX_HTML = /(^|\/)index\.html$/i;
const JS_MEDIA_TYPE = "text/javascript";

/** `event.data.source` / `.target` tag for the preview navigation bridge —
 * shared by the injected script and the `ArtifactFrame` listener. */
export const ARTIFACT_BRIDGE_SOURCE = "snak-artifact";

// Injected into the preview document (only when an address bar is shown) so the
// host can read the current location and drive navigation without `allow-same-
// origin` — the iframe stays an opaque origin and talks via postMessage only.
const NAV_BRIDGE_SCRIPT = `<script>(function(){
  var SRC=${JSON.stringify(ARTIFACT_BRIDGE_SOURCE)};
  function send(){try{parent.postMessage({source:SRC,href:location.href},"*");}catch(e){}}
  addEventListener("hashchange",send);addEventListener("popstate",send);addEventListener("load",send);
  addEventListener("message",function(e){var d=e.data||{};if(d.target!==SRC)return;
    if(d.cmd==="nav"&&typeof d.href==="string"){location.href=d.href;}
    else if(d.cmd==="back"){history.back();}
    else if(d.cmd==="forward"){history.forward();}
    else if(d.cmd==="reload"){location.reload();}});
  send();
})();</script>`;

/** Insert markup just before `</body>` (or append if there's no body tag). */
function injectBeforeBodyEnd(doc: string, markup: string): string {
  const i = doc.toLowerCase().lastIndexOf("</body>");
  return i === -1 ? doc + markup : doc.slice(0, i) + markup + doc.slice(i);
}

/** Options for {@link assembleArtifact}. */
export interface AssembleOptions {
  /** Inject the navigation bridge so a host address bar can track/drive the
   * preview's location. Off for export/open-in-browser (chrome-free output). */
  navBridge?: boolean;
}

/**
 * Parse the body of an ` ```artifact ` block into `{ title, files }`.
 *
 * Returns `null` when no file delimiter has appeared yet — the streaming-safe
 * gate (mirroring how Mermaid/Vega only render once their source parses): the
 * card shows a "Building…" placeholder until at least one file is declared.
 *
 * Leading lines before the first `--- path ---` delimiter form the header; a
 * `title:` (or `title=`) line there sets the title. The title otherwise falls
 * back to the `<title>` of an HTML file, then to "Artifact".
 */
export function parseArtifact(text: string): ParsedArtifact | null {
  const lines = text.split("\n");
  let title = "";
  const files: ArtifactFile[] = [];
  let current: ArtifactFile | null = null;
  let inHeader = true;

  for (const line of lines) {
    const delim = DELIMITER.exec(line);
    if (delim) {
      inHeader = false;
      current = { path: delim[1].trim(), content: "" };
      files.push(current);
      continue;
    }
    if (inHeader) {
      const t = TITLE_LINE.exec(line);
      if (t && !title) title = t[1].trim();
      continue;
    }
    if (current) current.content += current.content === "" ? line : "\n" + line;
  }

  if (files.length === 0) return null;
  // Trim a single trailing newline-run left by the block's closing fence.
  for (const f of files) f.content = f.content.replace(/\s+$/, "");
  if (!title) title = titleFromHtml(files) ?? "Artifact";
  return { title, files };
}

/**
 * Serialize files back into the artifact block body (the inverse of
 * `parseArtifact`) — used to hand the current artifact to the AI editor.
 */
export function serializeArtifact(
  title: string,
  files: ArtifactFile[],
): string {
  const head = title ? `title: ${title}\n` : "";
  const body = files.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n");
  return head + body;
}

/**
 * Extract the body of the first ` ```artifact ` fenced block from a model
 * response (which may carry surrounding prose). Returns the inner text — up to
 * the closing fence, or to the end while the response is still streaming — or
 * `null` if no artifact fence has opened yet. Feed the result to `parseArtifact`.
 */
export function extractArtifactBlock(text: string): string | null {
  const open = /```artifact[^\n]*\n/i.exec(text);
  if (!open) return null;
  const rest = text.slice(open.index + open[0].length);
  const close = rest.indexOf("\n```");
  return close === -1 ? rest : rest.slice(0, close);
}

/** Recover a title from an HTML file's `<title>…</title>`, if any. */
function titleFromHtml(files: ArtifactFile[]): string | null {
  const html = pickHtml(files);
  if (!html) return null;
  const m = /<title>([^<]*)<\/title>/i.exec(html.content);
  const t = m?.[1]?.trim();
  return t ? t : null;
}

/** The entry HTML file: `index.html` if present, else the first `.html`. */
function pickHtml(files: ArtifactFile[]): ArtifactFile | null {
  return (
    files.find((f) => INDEX_HTML.test(f.path)) ??
    files.find((f) => HTML_FILE.test(f.path)) ??
    null
  );
}

/** Map each local JS/MJS file's path to a `data:` URL of its contents, so
 * cross-file module imports resolve inside an opaque sandboxed iframe. */
function buildJsDataUrls(files: ArtifactFile[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of files) {
    if (JS_FILE.test(f.path))
      map.set(normalizeRef(f.path), dataUrl(f.content, JS_MEDIA_TYPE));
  }
  return map;
}

/** Normalize a referenced path to compare against file paths (drop ./ and /). */
function normalizeRef(ref: string): string {
  return ref.replace(/^\.?\//, "").trim();
}

/** A reference is "local" (resolvable within the artifact) when it isn't an
 * absolute URL or a protocol-relative/data/anchor reference. */
function isLocalRef(ref: string): boolean {
  return !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:)/i.test(ref.trim());
}

function attrValue(tag: string, name: string): string | null {
  const m = new RegExp(
    `${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(tag);
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? "";
}

function base64Utf8(text: string): string {
  // btoa needs latin1; encode UTF-8 first so non-ASCII source survives.
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function dataUrl(content: string, mediaType: string): string {
  return `data:${mediaType};base64,${base64Utf8(content)}`;
}

/**
 * Assemble the artifact's files into a single self-contained HTML document for
 * an iframe `srcDoc`. Local `<link rel=stylesheet>` and `<script src>` refs are
 * inlined; local ES-module imports are rewritten to `data:` URLs (origin-safe
 * inside an opaque sandboxed iframe); absolute/CDN URLs pass through untouched.
 */
export function assembleArtifact(
  files: ArtifactFile[],
  opts: AssembleOptions = {},
): string {
  const byPath = new Map(files.map((f) => [normalizeRef(f.path), f]));
  const html = pickHtml(files);
  let doc = html ? html.content : synthesizeHtml(files);

  // Precompute data: URLs for local JS so module imports can be rewritten.
  const jsDataUrls = buildJsDataUrls(files);

  // Inline local stylesheet links.
  doc = doc.replace(/<link\b[^>]*>/gi, (tag) => {
    const rel = attrValue(tag, "rel") ?? "";
    const href = attrValue(tag, "href");
    if (href && isLocalRef(href) && /stylesheet/i.test(rel)) {
      const css = byPath.get(normalizeRef(href));
      if (css) return `<style>\n${css.content}\n</style>`;
    }
    return tag;
  });

  // Inline/rewrite local scripts. Module scripts keep their semantics; their
  // local relative imports are rewritten to data: URLs.
  doc = doc.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    (full, attrs: string, body: string) => {
      const src = attrValue(attrs, "src");
      const isModule = /type\s*=\s*["']?module/i.test(attrs);
      if (src && isLocalRef(src)) {
        const js = byPath.get(normalizeRef(src));
        if (js) {
          const code = isModule
            ? rewriteLocalImports(js.content, jsDataUrls)
            : js.content;
          return `<script${isModule ? ' type="module"' : ""}>\n${code}\n</script>`;
        }
        return full;
      }
      // Inline module with local imports → rewrite them in place too.
      if (isModule && !src) {
        return `<script${attrs}>\n${rewriteLocalImports(body, jsDataUrls)}\n</script>`;
      }
      return full;
    },
  );

  if (opts.navBridge) doc = injectBeforeBodyEnd(doc, NAV_BRIDGE_SCRIPT);
  return doc;
}

/** Replace `import … from './foo.js'` style local specifiers with data: URLs. */
function rewriteLocalImports(
  code: string,
  jsDataUrls: Map<string, string>,
): string {
  return code.replace(
    /(\bfrom\s+|\bimport\s+)(["'])([^"']+)\2/g,
    (full, kw: string, q: string, spec: string) => {
      if (!isLocalRef(spec)) return full;
      const url = jsDataUrls.get(normalizeRef(spec));
      return url ? `${kw}${q}${url}${q}` : full;
    },
  );
}

/** Build a minimal HTML wrapper when the artifact ships no `.html` file. */
function synthesizeHtml(files: ArtifactFile[]): string {
  const css = files
    .filter((f) => CSS_FILE.test(f.path))
    .map((f) => f.content)
    .join("\n");
  const jsDataUrls = buildJsDataUrls(files);
  const scripts = files
    .filter((f) => JS_FILE.test(f.path))
    .map(
      (f) =>
        `<script type="module">\n${rewriteLocalImports(f.content, jsDataUrls)}\n</script>`,
    )
    .join("\n");
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    `<style>\n${css}\n</style>`,
    "</head><body>",
    scripts,
    "</body></html>",
  ].join("\n");
}

/** Best-effort MIME type for a file path (zip export + editor language hints). */
export function guessMediaType(path: string): string {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "html":
    case "htm":
      return "text/html";
    case "css":
      return "text/css";
    case "js":
    case "mjs":
      return JS_MEDIA_TYPE;
    case "json":
      return "application/json";
    case "svg":
      return "image/svg+xml";
    default:
      return "text/plain";
  }
}

/**
 * System text teaching the model the ` ```artifact ` format — returned only
 * when the artifact renderer is enabled (empty otherwise, so chats are
 * unaffected with the plugin off). Mirrors `buildChartsSystemText`.
 */
export function buildArtifactsSystemText(reg: HostRegistry): string {
  if (!hasRenderer(reg, ARTIFACT_LANGUAGE)) return "";
  return [
    "## Artifacts",
    "When the user asks you to build a web app, page, game, or self-contained " +
      "front-end, emit it as an **artifact**: a single fenced code block tagged " +
      "`artifact`. Inside the block, optionally start with a `title:` line, then " +
      "declare each file with a delimiter line `--- <path> ---` followed by that " +
      "file's full contents.",
    "Rules:",
    "- The entry point must be `index.html`.",
    "- Reference sibling files with relative paths (e.g. " +
      '`<link rel="stylesheet" href="style.css">`, `<script src="script.js">' +
      "</script>`); the app inlines them automatically.",
    "- Load libraries from a CDN (esm.sh, unpkg, jsDelivr) via `<script>` tags " +
      "or an import map — network requests work in the preview.",
    "- Never put a literal triple-backtick inside the artifact (it would end " +
      "the block).",
    "The app renders the block as a live, editable preview (the raw source is " +
      "shown while it streams).",
  ].join("\n");
}
