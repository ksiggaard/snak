import { describe, expect, it } from "vitest";
import { splitSentenceRanges } from "@/lib/readAlong";

describe("splitSentenceRanges", () => {
  it("splits on sentence terminators and trims to tight ranges", () => {
    const text = "Hello there. How are you? I am fine!";
    const ranges = splitSentenceRanges(text);
    expect(ranges.map((r) => r.text)).toEqual([
      "Hello there.",
      "How are you?",
      "I am fine!",
    ]);
    // Each range maps back to its exact substring (no leading/trailing space).
    for (const r of ranges) {
      expect(text.slice(r.start, r.end)).toBe(r.text);
    }
  });

  it("keeps a trailing fragment with no terminator", () => {
    const ranges = splitSentenceRanges("Done. And a tail");
    expect(ranges.map((r) => r.text)).toEqual(["Done.", "And a tail"]);
  });

  it("collapses repeated terminators into one sentence", () => {
    const ranges = splitSentenceRanges("Really?! Yes...");
    expect(ranges.map((r) => r.text)).toEqual(["Really?!", "Yes..."]);
  });

  it("returns nothing for blank input", () => {
    expect(splitSentenceRanges("   \n  ")).toEqual([]);
    expect(splitSentenceRanges("")).toEqual([]);
  });

  it("does not split on a period that isn't at a word boundary", () => {
    // No whitespace/end after the dot → treated as part of one chunk.
    const ranges = splitSentenceRanges("3.14 is pi");
    expect(ranges.map((r) => r.text)).toEqual(["3.14 is pi"]);
  });
});
