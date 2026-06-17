import { describe, it, expect } from "vitest";
import {
  buildWorkspaceSystemText,
  filterWorkspaceFiles,
  workspaceFilesSize,
  splitWorkspaceFiles,
  recentMemories,
  WORKSPACE_CONTEXT_CHAR_BUDGET,
} from "@/lib/workspaces";

const workspace = (instructions: string, name = "Acme") => ({
  name,
  instructions,
});

describe("buildWorkspaceSystemText", () => {
  it("returns empty string when there are no instructions and no files", () => {
    expect(buildWorkspaceSystemText(workspace(""), [])).toBe("");
  });

  it("includes instructions under a named header", () => {
    const out = buildWorkspaceSystemText(workspace("Be concise."), []);
    expect(out).toBe("Workspace: Acme\n\nBe concise.");
  });

  it("falls back to a generic header when the workspace is unnamed", () => {
    const out = buildWorkspaceSystemText(workspace("Be concise.", "  "), []);
    expect(out).toBe("Workspace context\n\nBe concise.");
  });

  it("labels and orders files, with the reference-context intro", () => {
    const out = buildWorkspaceSystemText(workspace("Use the docs."), [
      { name: "a.md", content: "Alpha" },
      { name: "b.md", content: "Beta" },
    ]);
    expect(out).toContain("Workspace: Acme\n\nUse the docs.");
    expect(out).toContain(
      "The following workspace files are provided as reference context:",
    );
    expect(out).toContain("--- a.md ---\nAlpha");
    expect(out).toContain("--- b.md ---\nBeta");
    expect(out.indexOf("a.md")).toBeLessThan(out.indexOf("b.md"));
  });

  it("includes files even when there are no instructions", () => {
    const out = buildWorkspaceSystemText(workspace(""), [
      { name: "a.md", content: "Alpha" },
    ]);
    expect(out).toContain("Workspace: Acme");
    expect(out).toContain("--- a.md ---\nAlpha");
    expect(out).not.toContain("\n\n\n");
  });

  it("truncates an overflowing file and notes dropped files", () => {
    const budget = 120;
    const out = buildWorkspaceSystemText(
      workspace("Hi"),
      [
        { name: "big.txt", content: "x".repeat(1000) },
        { name: "next.txt", content: "y".repeat(1000) },
      ],
      budget,
    );
    expect(out).toContain("[truncated to fit the context budget]");
    expect(out).toContain("1 more file omitted to fit the context budget");
    // The hard cap is budget + the truncation/omission markers only.
    expect(out).not.toContain("y".repeat(10));
  });

  it("drops whole files once the budget is already exhausted", () => {
    const intro =
      "Workspace: Acme\n\nThe following workspace files are provided as reference context:";
    // Budget just past the first file so the second can't start.
    const first = { name: "a.txt", content: "a".repeat(40) };
    const out = buildWorkspaceSystemText(
      { name: "Acme", instructions: "" },
      [first, { name: "b.txt", content: "b".repeat(40) }],
      intro.length + `\n\n--- a.txt ---\n${first.content}`.length,
    );
    expect(out).toContain("--- a.txt ---");
    expect(out).not.toContain("--- b.txt ---");
    expect(out).toContain("1 more file omitted");
  });

  it("uses a sane default budget", () => {
    expect(WORKSPACE_CONTEXT_CHAR_BUDGET).toBeGreaterThan(10_000);
  });
});

describe("filterWorkspaceFiles", () => {
  const files = [
    { id: "a", name: "a.md", content: "Alpha" },
    { id: "b", name: "b.md", content: "Beta" },
    { id: "c", name: "c.md", content: "Gamma" },
  ];

  it("returns all files when excluded set is empty (default all selected)", () => {
    expect(filterWorkspaceFiles(files, [])).toEqual(files);
  });

  it("returns all files when excluded set is null/undefined (backward compat)", () => {
    expect(filterWorkspaceFiles(files, null)).toEqual(files);
  });

  it("excludes the ids in the excluded set", () => {
    const result = filterWorkspaceFiles(files, ["b"]);
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.id)).toEqual(["a", "c"]);
  });

  it("excludes multiple ids", () => {
    const result = filterWorkspaceFiles(files, ["a", "c"]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b");
  });

  it("returns empty array when all files are excluded", () => {
    expect(filterWorkspaceFiles(files, ["a", "b", "c"])).toEqual([]);
  });

  it("ignores excluded ids that don't match any file (robustness)", () => {
    const result = filterWorkspaceFiles(files, ["x", "y"]);
    expect(result).toEqual(files);
  });

  it("a newly added file (not in excluded set) is automatically included", () => {
    const withNew = [
      ...files,
      { id: "d", name: "d.md", content: "Delta" },
    ];
    // Excluded set was captured before the new file was added — "d" is not in it.
    const result = filterWorkspaceFiles(withNew, ["b"]);
    expect(result.map((f) => f.id)).toEqual(["a", "c", "d"]);
  });

  it("returns empty array for empty file list", () => {
    expect(filterWorkspaceFiles([], ["a"])).toEqual([]);
  });
});

describe("workspaceFilesSize", () => {
  it("sums file content lengths", () => {
    expect(
      workspaceFilesSize([
        { content: "abc" },
        { content: "de" },
        { content: "" },
      ]),
    ).toBe(5);
  });

  it("is zero for no files", () => {
    expect(workspaceFilesSize([])).toBe(0);
  });
});

// --------------------------------------------------------------------------
// splitWorkspaceFiles
// --------------------------------------------------------------------------

describe("splitWorkspaceFiles", () => {
  it("separates uploaded files (null source_url) from URL files", () => {
    const files = [
      { id: "a", source_url: null },
      { id: "b", source_url: "https://example.com" },
      { id: "c", source_url: null },
    ];
    const { uploaded, urls } = splitWorkspaceFiles(files);
    expect(uploaded.map((f) => f.id)).toEqual(["a", "c"]);
    expect(urls.map((f) => f.id)).toEqual(["b"]);
  });

  it("returns all as uploaded when no file has a source_url", () => {
    const files = [
      { id: "a", source_url: null },
      { id: "b", source_url: null },
    ];
    const { uploaded, urls } = splitWorkspaceFiles(files);
    expect(uploaded).toHaveLength(2);
    expect(urls).toHaveLength(0);
  });

  it("returns all as urls when every file has a source_url", () => {
    const files = [
      { id: "a", source_url: "https://a.com" },
      { id: "b", source_url: "https://b.com" },
    ];
    const { uploaded, urls } = splitWorkspaceFiles(files);
    expect(uploaded).toHaveLength(0);
    expect(urls).toHaveLength(2);
  });

  it("returns empty arrays for an empty list", () => {
    const { uploaded, urls } = splitWorkspaceFiles([]);
    expect(uploaded).toHaveLength(0);
    expect(urls).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// recentMemories
// --------------------------------------------------------------------------

function mem(id: string, updated_at: string, content = "") {
  return { id, workspace_id: "ws", content, created_at: "2024-01-01", updated_at };
}

describe("recentMemories", () => {
  it("returns entries sorted by updated_at descending", () => {
    const entries = [
      mem("a", "2024-01-01 10:00:00"),
      mem("b", "2024-01-03 10:00:00"),
      mem("c", "2024-01-02 10:00:00"),
    ];
    const result = recentMemories(entries, 10);
    expect(result.map((m) => m.id)).toEqual(["b", "c", "a"]);
  });

  it("caps the result at n entries", () => {
    const entries = [
      mem("a", "2024-01-04"),
      mem("b", "2024-01-03"),
      mem("c", "2024-01-02"),
      mem("d", "2024-01-01"),
    ];
    const result = recentMemories(entries, 2);
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("returns all entries when fewer than n are present", () => {
    const entries = [mem("a", "2024-01-02"), mem("b", "2024-01-01")];
    const result = recentMemories(entries, 10);
    expect(result).toHaveLength(2);
  });

  it("does not mutate the original array", () => {
    const entries = [
      mem("a", "2024-01-01"),
      mem("b", "2024-01-03"),
    ];
    const original = [...entries];
    recentMemories(entries, 5);
    expect(entries).toEqual(original);
  });

  it("returns empty array for empty input", () => {
    expect(recentMemories([], 5)).toHaveLength(0);
  });
});
