import { describe, it, expect } from "vitest";
import {
  appendDocumentsToContent,
  buildDocumentBlock,
  classifyFile,
  DOCUMENT_CHAR_BUDGET,
  documentMediaType,
  TRUNCATION_MARKER,
  truncateDocumentText,
} from "@/lib/documents";

describe("classifyFile", () => {
  it("classifies by image MIME type first", () => {
    expect(classifyFile("photo.png", "image/png")).toBe("image");
    expect(classifyFile("noext", "image/jpeg")).toBe("image");
    // An SVG with an image MIME goes through the image pipeline.
    expect(classifyFile("logo.svg", "image/svg+xml")).toBe("image");
  });

  it("classifies code files with no MIME type as text via the extension", () => {
    expect(classifyFile("main.rs", "")).toBe("text");
    expect(classifyFile("notes.md", "")).toBe("text");
    expect(classifyFile("Component.TSX", "")).toBe("text");
  });

  it("classifies text/* and common text-bearing MIMEs as text", () => {
    expect(classifyFile("readme", "text/plain")).toBe("text");
    expect(classifyFile("data.json", "application/json")).toBe("text");
    expect(classifyFile("feed.xml", "application/xml")).toBe("text");
  });

  it("classifies extractor formats as binary-document, case-insensitively", () => {
    expect(classifyFile("report.PDF", "")).toBe("binary-document");
    expect(classifyFile("deck.pptx", "")).toBe("binary-document");
    expect(classifyFile("sheet.ods", "application/octet-stream")).toBe(
      "binary-document",
    );
  });

  it("classifies pre-OOXML Office files as legacy-document", () => {
    expect(classifyFile("old.doc", "application/msword")).toBe(
      "legacy-document",
    );
    expect(classifyFile("old.xls", "")).toBe("legacy-document");
    expect(classifyFile("old.ppt", "")).toBe("legacy-document");
  });

  it("classifies everything else as unsupported", () => {
    expect(classifyFile("blob.bin", "")).toBe("unsupported");
    expect(classifyFile("app.exe", "application/octet-stream")).toBe(
      "unsupported",
    );
    expect(classifyFile("noext", "")).toBe("unsupported");
  });
});

describe("documentMediaType", () => {
  it("prefers the browser-reported MIME type", () => {
    expect(documentMediaType("a.json", "application/json")).toBe(
      "application/json",
    );
    expect(documentMediaType("a.pdf", "application/pdf")).toBe(
      "application/pdf",
    );
  });

  it("derives a media type from the extension when the MIME is empty", () => {
    expect(documentMediaType("a.pdf", "")).toBe("application/pdf");
    expect(documentMediaType("a.md", "")).toBe("text/markdown");
    expect(documentMediaType("a.docx", "")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("falls back to text/plain for unknown extensions", () => {
    expect(documentMediaType("main.rs", "")).toBe("text/plain");
    expect(documentMediaType("noext", "")).toBe("text/plain");
  });
});

describe("truncateDocumentText", () => {
  it("is a no-op under the budget", () => {
    expect(truncateDocumentText("short", 10)).toEqual({
      text: "short",
      truncated: false,
    });
    const exact = "x".repeat(10);
    expect(truncateDocumentText(exact, 10)).toEqual({
      text: exact,
      truncated: false,
    });
  });

  it("truncates over-budget text, appending the marker and setting the flag", () => {
    const { text, truncated } = truncateDocumentText("abcdef", 3);
    expect(truncated).toBe(true);
    expect(text).toBe("abc" + TRUNCATION_MARKER);
  });

  it("defaults to the document char budget", () => {
    const big = "y".repeat(DOCUMENT_CHAR_BUDGET + 1);
    const { text, truncated } = truncateDocumentText(big);
    expect(truncated).toBe(true);
    expect(text.startsWith("y".repeat(DOCUMENT_CHAR_BUDGET))).toBe(true);
    expect(text.endsWith(TRUNCATION_MARKER)).toBe(true);
  });
});

describe("buildDocumentBlock", () => {
  it("wraps the text in a labelled three-backtick fence", () => {
    expect(buildDocumentBlock({ name: "notes.txt", text: "hello" })).toBe(
      "--- Attached document: notes.txt ---\n```\nhello\n```",
    );
  });

  it("lengthens the fence past the longest backtick run in the text", () => {
    const text = "intro\n```js\ncode\n```\noutro";
    const block = buildDocumentBlock({ name: "a.md", text });
    expect(block).toBe(
      `--- Attached document: a.md ---\n\`\`\`\`\n${text}\n\`\`\`\``,
    );
  });
});

describe("appendDocumentsToContent", () => {
  it("returns the content byte-identical when there are no documents", () => {
    expect(appendDocumentsToContent("hello ", [])).toBe("hello ");
    expect(appendDocumentsToContent("", [])).toBe("");
  });

  it("appends a block after the content", () => {
    const out = appendDocumentsToContent("see attached", [
      { name: "a.txt", text: "alpha" },
    ]);
    expect(out).toBe(
      "see attached\n\n--- Attached document: a.txt ---\n```\nalpha\n```",
    );
  });

  it("joins multiple documents with blank lines", () => {
    const out = appendDocumentsToContent("q", [
      { name: "a.txt", text: "alpha" },
      { name: "b.txt", text: "beta" },
    ]);
    expect(out).toBe(
      "q\n\n" +
        "--- Attached document: a.txt ---\n```\nalpha\n```\n\n" +
        "--- Attached document: b.txt ---\n```\nbeta\n```",
    );
  });

  it("yields just the blocks for an empty content", () => {
    const out = appendDocumentsToContent("", [
      { name: "a.txt", text: "alpha" },
    ]);
    expect(out).toBe("--- Attached document: a.txt ---\n```\nalpha\n```");
  });
});
