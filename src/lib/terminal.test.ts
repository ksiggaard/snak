import { describe, expect, it } from "vitest";
import { isShellLanguage } from "@/lib/terminal";

describe("isShellLanguage", () => {
  it("matches common shell languages", () => {
    expect(isShellLanguage("bash")).toBe(true);
    expect(isShellLanguage("sh")).toBe(true);
    expect(isShellLanguage("shell")).toBe(true);
    expect(isShellLanguage("zsh")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isShellLanguage("Bash")).toBe(true);
    expect(isShellLanguage("SH")).toBe(true);
  });

  it("rejects non-shell languages", () => {
    expect(isShellLanguage("python")).toBe(false);
    expect(isShellLanguage("ts")).toBe(false);
    expect(isShellLanguage("text")).toBe(false);
  });

  it("rejects null/undefined/empty", () => {
    expect(isShellLanguage(null)).toBe(false);
    expect(isShellLanguage(undefined)).toBe(false);
    expect(isShellLanguage("")).toBe(false);
  });
});
