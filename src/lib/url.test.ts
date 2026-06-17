import { describe, it, expect } from "vitest";
import { validateUrl } from "@/lib/url";

describe("validateUrl", () => {
  it("accepts a valid https URL", () => {
    expect(validateUrl("https://example.com")).toBeNull();
  });

  it("accepts a valid http URL", () => {
    expect(validateUrl("http://example.com")).toBeNull();
  });

  it("accepts a URL with a path and query string", () => {
    expect(validateUrl("https://example.com/path?q=hello")).toBeNull();
  });

  it("trims leading/trailing whitespace before checking", () => {
    expect(validateUrl("  https://example.com  ")).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(validateUrl("")).not.toBeNull();
  });

  it("rejects a URL with internal whitespace", () => {
    expect(validateUrl("https://exam ple.com")).not.toBeNull();
  });

  it("rejects a URL without a scheme", () => {
    expect(validateUrl("example.com")).not.toBeNull();
  });

  it("rejects ftp:// scheme", () => {
    expect(validateUrl("ftp://example.com")).not.toBeNull();
  });

  it("rejects https:// with no host", () => {
    expect(validateUrl("https://")).not.toBeNull();
  });

  it("returns a human-readable string on error", () => {
    const err = validateUrl("not-a-url");
    expect(typeof err).toBe("string");
    expect(err!.length).toBeGreaterThan(5);
  });
});
