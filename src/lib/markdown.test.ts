import { describe, expect, it } from "vitest";
import {
  codeText,
  flattenSnippet,
  languageFromClassName,
} from "@/lib/markdown";

describe("languageFromClassName", () => {
  it("returns null for undefined or empty", () => {
    expect(languageFromClassName(undefined)).toBeNull();
    expect(languageFromClassName("")).toBeNull();
  });

  it("extracts the language from a language-* class", () => {
    expect(languageFromClassName("language-bash")).toBe("bash");
    expect(languageFromClassName("language-TypeScript")).toBe("typescript");
  });

  it("finds language-* among other classes (e.g. hljs)", () => {
    expect(languageFromClassName("hljs language-python")).toBe("python");
    expect(languageFromClassName("language-sh hljs language-bash")).toBe("sh");
  });

  it("handles languages with special chars (c++, c#, objective-c)", () => {
    expect(languageFromClassName("language-c++")).toBe("c++");
    expect(languageFromClassName("language-c#")).toBe("c#");
    expect(languageFromClassName("language-objective-c")).toBe("objective-c");
  });

  it("returns null when there is no language- class (bare fence)", () => {
    expect(languageFromClassName("hljs")).toBeNull();
    expect(languageFromClassName("some-other-class")).toBeNull();
  });
});

describe("codeText", () => {
  it("returns strings and numbers directly", () => {
    expect(codeText("hello")).toBe("hello");
    expect(codeText(42)).toBe("42");
  });

  it("joins arrays of children", () => {
    expect(codeText(["a", "b", "c"])).toBe("abc");
  });

  it("recurses into element-like objects with props.children", () => {
    const el = {
      props: { children: ["echo ", { props: { children: "hi" } }] },
    };
    expect(codeText(el)).toBe("echo hi");
  });

  it("returns empty string for null/undefined/unknown", () => {
    expect(codeText(null)).toBe("");
    expect(codeText(undefined)).toBe("");
    expect(codeText(true)).toBe("");
  });
});

describe("flattenSnippet", () => {
  it("returns plain text unchanged", () => {
    expect(flattenSnippet("Hello there")).toBe("Hello there");
  });

  it("collapses newlines and whitespace to one line", () => {
    expect(flattenSnippet("First line\n\nSecond   line")).toBe(
      "First line Second line",
    );
  });

  it("strips heading markers", () => {
    expect(flattenSnippet("## Plan\nDo the thing")).toBe("Plan Do the thing");
  });

  it("strips emphasis, strikethrough, and inline code markers", () => {
    expect(flattenSnippet("**bold** and *em* and `code` and ~~gone~~")).toBe(
      "bold and em and code and gone",
    );
  });

  it("keeps code content but drops fence markers", () => {
    expect(flattenSnippet("```js\nconst x = 1;\n```")).toBe("const x = 1;");
  });

  it("flattens links and images to their text", () => {
    expect(
      flattenSnippet("See [the docs](https://x.dev) and ![alt](img.png)"),
    ).toBe("See the docs and alt");
  });

  it("strips blockquote and list markers (incl. task checkboxes)", () => {
    expect(flattenSnippet("> quoted")).toBe("quoted");
    expect(flattenSnippet("- [x] done\n2. second")).toBe("done second");
  });

  it("drops horizontal rules and table chrome", () => {
    expect(flattenSnippet("above\n---\nbelow")).toBe("above below");
    expect(flattenSnippet("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe(
      "a b 1 2",
    );
  });

  it("truncates to maxLen with an ellipsis", () => {
    const out = flattenSnippet("word ".repeat(100), 30);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.endsWith("…")).toBe(true);
  });

  it("handles empty input", () => {
    expect(flattenSnippet("")).toBe("");
  });
});
