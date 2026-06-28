import { describe, expect, it } from "vitest";
import {
  activeHashtagQuery,
  buildHashtagDirective,
  buildHashtags,
  extractHashtags,
  matchHashtags,
  type Hashtag,
} from "@/lib/hashtags";

const tool = (
  server_id: string,
  name: string,
  description = "",
): {
  server_id: string;
  name: string;
  description: string;
} => ({ server_id, name, description });

describe("activeHashtagQuery", () => {
  it("detects a # at the start of the text", () => {
    expect(activeHashtagQuery("#fe", 3)).toEqual({
      start: 0,
      end: 3,
      query: "fe",
    });
  });

  it("detects a # after whitespace mid-text", () => {
    expect(activeHashtagQuery("show #ma", 8)).toEqual({
      start: 5,
      end: 8,
      query: "ma",
    });
  });

  it("detects a # after a newline", () => {
    expect(activeHashtagQuery("hello\n#m", 8)).toEqual({
      start: 6,
      end: 8,
      query: "m",
    });
  });

  it("returns an empty query for a bare # (lists all)", () => {
    expect(activeHashtagQuery("#", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("is null for a markdown heading (space right after #)", () => {
    expect(activeHashtagQuery("# Heading", 9)).toBeNull();
  });

  it("is null for a non-anchored # (e.g. C#)", () => {
    expect(activeHashtagQuery("C#", 2)).toBeNull();
  });

  it("is null when whitespace separates the # from the caret", () => {
    expect(activeHashtagQuery("#map hello", 10)).toBeNull();
  });

  it("extends end to the rest of the token when the caret is mid-token", () => {
    expect(activeHashtagQuery("use #search later", 8)).toEqual({
      start: 4,
      end: 11,
      query: "sea",
    });
  });
});

describe("buildHashtags", () => {
  it("builds tool + renderer entries, deduped and sorted by tag", () => {
    const out = buildHashtags(
      [tool("web", "search_web", "Search"), tool("web", "fetch_url", "Fetch")],
      ["artifact", "vega-lite"],
    );
    expect(out.map((h) => h.tag)).toEqual([
      "artifact",
      "fetch_url",
      "search_web",
      "vega-lite",
    ]);
    const search = out.find((h) => h.tag === "search_web")!;
    expect(search).toMatchObject({ kind: "tool", target: "web__search_web" });
    const artifact = out.find((h) => h.tag === "artifact")!;
    expect(artifact).toMatchObject({ kind: "renderer", target: "artifact" });
  });

  it("first-wins on a tag collision (tool beats a same-named renderer)", () => {
    const out = buildHashtags([tool("web", "map", "")], ["map"]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "tool", target: "web__map" });
  });
});

describe("matchHashtags", () => {
  const hashtags = buildHashtags(
    [tool("web", "search_web"), tool("web", "search_images")],
    ["map", "mermaid"],
  );

  it("filters by case-insensitive tag prefix", () => {
    expect(matchHashtags("SEARCH_", hashtags).map((h) => h.tag)).toEqual([
      "search_images",
      "search_web",
    ]);
  });

  it("lists all for an empty query, sorted", () => {
    expect(matchHashtags("", hashtags).map((h) => h.tag)).toEqual([
      "map",
      "mermaid",
      "search_images",
      "search_web",
    ]);
  });

  it("returns [] on no match", () => {
    expect(matchHashtags("zzz", hashtags)).toEqual([]);
  });
});

describe("extractHashtags", () => {
  const hashtags = buildHashtags(
    [tool("web", "search_web")],
    ["map", "vega-lite"],
  );

  it("strips a recognized trailing hashtag and reports it", () => {
    const r = extractHashtags("Show Paris on a #map", hashtags);
    expect(r.found.map((h) => h.tag)).toEqual(["map"]);
    expect(r.cleaned).toBe("Show Paris on a");
  });

  it("strips a mid-text hashtag without leaving a double space", () => {
    const r = extractHashtags("draw #map please", hashtags);
    expect(r.found.map((h) => h.tag)).toEqual(["map"]);
    expect(r.cleaned).toBe("draw please");
  });

  it("keeps unrecognized hashtags as plain text", () => {
    const r = extractHashtags("just #random notes", hashtags);
    expect(r.found).toEqual([]);
    expect(r.cleaned).toBe("just #random notes");
  });

  it("never matches a non-anchored # (C#) or trailing punctuation token", () => {
    expect(extractHashtags("I love C# a lot", hashtags).found).toEqual([]);
  });

  it("matches a tag with a hyphen and trailing punctuation boundary", () => {
    const r = extractHashtags("chart it #vega-lite.", hashtags);
    expect(r.found.map((h) => h.tag)).toEqual(["vega-lite"]);
    expect(r.cleaned).toBe("chart it .");
  });

  it("dedupes repeated hashtags, first-mention order", () => {
    const r = extractHashtags("#map and #search_web and #map again", hashtags);
    expect(r.found.map((h) => h.tag)).toEqual(["map", "search_web"]);
  });

  it("returns the text unchanged when nothing matched", () => {
    expect(extractHashtags("no hashtags here", hashtags).cleaned).toBe(
      "no hashtags here",
    );
  });
});

describe("buildHashtagDirective", () => {
  const hashtags = buildHashtags([tool("web", "search_web")], ["artifact"]);
  const byTag = (t: string): Hashtag => hashtags.find((h) => h.tag === t)!;

  it("returns '' for no hashtags", () => {
    expect(buildHashtagDirective([])).toBe("");
  });

  it("emits an imperative tool line with the namespaced target", () => {
    expect(buildHashtagDirective([byTag("search_web")])).toContain(
      "`web__search_web` tool",
    );
  });

  it("emits the renderer phrasing for a renderer hashtag", () => {
    expect(buildHashtagDirective([byTag("artifact")])).toContain(
      "`artifact` fenced code block",
    );
  });
});
