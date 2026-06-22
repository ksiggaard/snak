import { describe, expect, it } from "vitest";
import { extractSpeakableText } from "@/lib/audio";

describe("extractSpeakableText", () => {
  it("drops fenced code blocks entirely", () => {
    const md = [
      "Here is the answer:",
      "```ts",
      "const x = 1;",
      "doNotReadThis();",
      "```",
      "That is all.",
    ].join("\n");
    const out = extractSpeakableText(md);
    expect(out).not.toContain("const x");
    expect(out).not.toContain("doNotReadThis");
    expect(out).toContain("Here is the answer");
    expect(out).toContain("That is all");
  });

  it("drops an unterminated (streaming) code fence and its body", () => {
    const md = "Intro line.\n```python\nprint('partial')";
    const out = extractSpeakableText(md);
    expect(out).toContain("Intro line");
    expect(out).not.toContain("print");
  });

  it("unwraps inline code, emphasis, and links to their text", () => {
    const md = "Use `npm run build`, it is **fast** and [docs](http://x).";
    const out = extractSpeakableText(md);
    expect(out).toContain("npm run build");
    expect(out).toContain("fast");
    expect(out).toContain("docs");
    expect(out).not.toContain("http://x");
    expect(out).not.toContain("`");
    expect(out).not.toContain("**");
  });

  it("strips heading, list, and quote markers", () => {
    const md = "# Title\n\n- one\n- two\n\n> quoted";
    const out = extractSpeakableText(md);
    expect(out).toContain("Title");
    expect(out).toContain("one");
    expect(out).toContain("two");
    expect(out).toContain("quoted");
    expect(out).not.toContain("#");
    expect(out).not.toMatch(/^- /m);
  });

  it("drops table rows and images", () => {
    const md = "Answer.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n![alt](img.png)";
    const out = extractSpeakableText(md);
    expect(out).toContain("Answer");
    expect(out).not.toContain("|");
    expect(out).not.toContain("alt");
  });

  it("returns empty for code-only content", () => {
    expect(extractSpeakableText("```\njust code\n```")).toBe("");
  });
});
