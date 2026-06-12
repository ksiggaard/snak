// T39 — document attachments. Pure helpers for classifying picked files,
// truncating extracted text to a context budget, and folding document text
// into outgoing message content, plus a thin wrapper over the Rust
// `extract_document_text` command (PDF/Office text extraction happens in the
// backend; the webview only ever sees the extracted text).
//
// Storage model: a document attachment row (`kind = "document"`) keeps the
// *extracted text* in `data` and the original file name in `filename`
// (migration 012). The text is injected into the API history as a labelled
// fenced block appended to the user turn's content — see
// `appendDocumentsToContent`, applied at the single seam in
// `src/lib/compaction.ts` (`compactHistory`).

import { invoke } from "@tauri-apps/api/core";

/** Max characters of extracted text carried per document (rest is truncated). */
export const DOCUMENT_CHAR_BUDGET = 100_000;

/** Max raw file size accepted for text extraction. */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** How a picked file is handled by the attach flow. */
export type FileClass =
  | "image"
  | "text"
  | "binary-document"
  | "legacy-document"
  | "unsupported";

/** A document staged in the composer, ready to send. */
export interface PendingDocument {
  name: string;
  mediaType: string;
  /** Extracted (and possibly truncated) text. */
  text: string;
  truncated: boolean;
}

/** Binary formats the backend extractor understands. */
const BINARY_DOCUMENT_EXTS = new Set([
  "pdf",
  "docx",
  "pptx",
  "odt",
  "odp",
  "xlsx",
  "ods",
]);

/** Pre-OOXML Office formats — recognized so we can explain, not extract. */
const LEGACY_DOCUMENT_EXTS = new Set(["doc", "ppt", "xls"]);

/** Generous code/text extension allowlist for files with no useful MIME type. */
const TEXT_EXTS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "jsonl",
  "yaml",
  "yml",
  "toml",
  "xml",
  "html",
  "htm",
  "css",
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "rs",
  "py",
  "go",
  "java",
  "c",
  "h",
  "cpp",
  "hpp",
  "cc",
  "hh",
  "cs",
  "rb",
  "php",
  "sh",
  "fish",
  "bash",
  "zsh",
  "sql",
  "ini",
  "cfg",
  "conf",
  "log",
  "tex",
  "svg",
  "vue",
  "svelte",
  "kt",
  "kts",
  "swift",
  "lua",
  "r",
  "m",
  "scala",
  "dart",
  "ex",
  "exs",
  "erl",
  "hs",
  "clj",
  "groovy",
  "gradle",
  "ps1",
  "bat",
  "cmd",
  "diff",
  "patch",
  "proto",
  "graphql",
  "env",
  "properties",
]);

/** Common text-bearing MIME types that don't start with `text/`. */
const TEXT_MIMES = new Set([
  "application/json",
  "application/xml",
  "application/xhtml+xml",
  "application/javascript",
  "application/x-javascript",
  "application/typescript",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/sql",
  "application/x-sh",
  "application/x-shellscript",
  "application/csv",
]);

/** Media types for storage when the browser reports no MIME type. */
const EXT_MEDIA_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  odt: "application/vnd.oasis.opendocument.text",
  odp: "application/vnd.oasis.opendocument.presentation",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  json: "application/json",
  xml: "application/xml",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  html: "text/html",
  htm: "text/html",
};

/** The file's extension, lowercased, or "" when it has none. */
export function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

/**
 * Decide how a picked file is handled. Images go through the existing image
 * pipeline; `text` is read in the webview; `binary-document` goes through the
 * Rust extractor; `legacy-document`/`unsupported` are surfaced to the user
 * (never silently dropped).
 */
export function classifyFile(name: string, mimeType: string): FileClass {
  if (mimeType.startsWith("image/")) return "image";
  const ext = fileExtension(name);
  if (BINARY_DOCUMENT_EXTS.has(ext)) return "binary-document";
  if (LEGACY_DOCUMENT_EXTS.has(ext)) return "legacy-document";
  if (mimeType.startsWith("text/") || TEXT_MIMES.has(mimeType)) return "text";
  if (TEXT_EXTS.has(ext)) return "text";
  return "unsupported";
}

/** The media type stored on the attachment row: the browser-reported MIME when
 * present, else one derived from the extension, else `text/plain`. */
export function documentMediaType(name: string, mimeType: string): string {
  if (mimeType) return mimeType;
  return EXT_MEDIA_TYPES[fileExtension(name)] ?? "text/plain";
}

/** Marker appended to truncated document text so the model knows it's partial. */
export const TRUNCATION_MARKER = "\n\n[… document truncated …]";

/** Cap document text at `budget` characters (a no-op when under budget). */
export function truncateDocumentText(
  text: string,
  budget: number = DOCUMENT_CHAR_BUDGET,
): { text: string; truncated: boolean } {
  if (text.length <= budget) return { text, truncated: false };
  return { text: text.slice(0, budget) + TRUNCATION_MARKER, truncated: true };
}

/**
 * One document as a labelled fenced block. The fence is one backtick longer
 * than the longest backtick run inside the text (min 3), so document content
 * containing code fences can never break out of the block.
 */
export function buildDocumentBlock(doc: {
  name: string;
  text: string;
}): string {
  let longestRun = 0;
  for (const run of doc.text.match(/`+/g) ?? []) {
    if (run.length > longestRun) longestRun = run.length;
  }
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `--- Attached document: ${doc.name} ---\n${fence}\n${doc.text}\n${fence}`;
}

/**
 * Fold document blocks into a message's outgoing content. With no documents
 * the content is returned unchanged (byte-identical — keeps document-less
 * turns stable); otherwise the blocks follow the content (which may be empty)
 * separated by blank lines.
 */
export function appendDocumentsToContent(
  content: string,
  docs: { name: string; text: string }[],
): string {
  if (docs.length === 0) return content;
  const blocks = docs.map(buildDocumentBlock).join("\n\n");
  const head = content.trimEnd();
  return head ? `${head}\n\n${blocks}` : blocks;
}

/** Read a File as base64 (the raw payload, without the `data:` URL prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      const url = reader.result as string;
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Extract a binary document's text via the Rust `extract_document_text`
 * command. Size-gated here so a huge file never round-trips through base64.
 * Rejects with a user-readable string/Error on failure (the command itself
 * throws a readable string per its contract).
 */
export async function extractDocumentText(file: File): Promise<string> {
  if (file.size > MAX_DOCUMENT_BYTES) {
    const maxMb = Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024));
    throw new Error(`"${file.name}" is too large to attach (max ${maxMb} MB).`);
  }
  const dataB64 = await fileToBase64(file);
  return invoke("extract_document_text", { dataB64, fileName: file.name });
}
