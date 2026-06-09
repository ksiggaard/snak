import { describe, expect, it } from "vitest";
import { codeText, languageFromClassName } from "@/lib/markdown";

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
