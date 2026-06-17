import { describe, it, expect } from "vitest";
import {
  buildWorkspaceSystemText,
  workspaceFilesSize,
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
