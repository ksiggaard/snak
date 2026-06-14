import { describe, it, expect } from "vitest";
import {
  buildYouTubeSystemText,
  embeddedYouTubeIds,
  parseYouTubeUrl,
  youTubeEmbedSrc,
} from "@/lib/youtube";
import type { HostRegistry } from "@/lib/plugins";

const registry = (languages: string[]): HostRegistry => ({
  providers: [],
  themes: [],
  skills: [],
  slashCommands: [],
  renderers: languages.map((language) => ({ language })),
});

describe("parseYouTubeUrl", () => {
  it("parses the standard watch URL", () => {
    expect(parseYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual(
      { id: "dQw4w9WgXcQ", start: undefined },
    );
  });

  it("parses youtu.be short links", () => {
    expect(parseYouTubeUrl("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      id: "dQw4w9WgXcQ",
      start: undefined,
    });
  });

  it("parses embed, shorts, live and /v/ forms", () => {
    for (const u of [
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ",
      "https://www.youtube.com/v/dQw4w9WgXcQ",
    ]) {
      expect(parseYouTubeUrl(u)?.id).toBe("dQw4w9WgXcQ");
    }
  });

  it("accepts m. / music. / nocookie hosts and extra query params", () => {
    expect(
      parseYouTubeUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=abc")?.id,
    ).toBe("dQw4w9WgXcQ");
    expect(
      parseYouTubeUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ")?.id,
    ).toBe("dQw4w9WgXcQ");
    expect(
      parseYouTubeUrl("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")?.id,
    ).toBe("dQw4w9WgXcQ");
  });

  it("parses start offsets (seconds and 1h2m3s forms)", () => {
    expect(parseYouTubeUrl("https://youtu.be/dQw4w9WgXcQ?t=90")?.start).toBe(90);
    expect(
      parseYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s")
        ?.start,
    ).toBe(90);
    expect(
      parseYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&start=45")
        ?.start,
    ).toBe(45);
  });

  it("rejects non-YouTube hosts, bad ids, and non-video paths", () => {
    expect(parseYouTubeUrl("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYouTubeUrl("https://www.youtube.com/watch?v=tooShort")).toBeNull();
    expect(parseYouTubeUrl("https://www.youtube.com/feed/subscriptions")).toBeNull();
    expect(parseYouTubeUrl("not a url")).toBeNull();
    expect(parseYouTubeUrl("ftp://youtu.be/dQw4w9WgXcQ")).toBeNull();
  });
});

describe("youTubeEmbedSrc", () => {
  it("builds an autoplay nocookie embed URL", () => {
    expect(youTubeEmbedSrc({ id: "dQw4w9WgXcQ" })).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0",
    );
  });

  it("includes the start offset when present", () => {
    expect(youTubeEmbedSrc({ id: "dQw4w9WgXcQ", start: 90 })).toContain(
      "start=90",
    );
  });
});

describe("embeddedYouTubeIds", () => {
  it("returns ids for standalone-paragraph links (bare URL and markdown link)", () => {
    const content =
      "Here is a video:\n\n" +
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ\n\n" +
      "And another:\n\n" +
      "[Watch this](https://youtu.be/aaaaaaaaaaa)";
    expect(embeddedYouTubeIds(content)).toEqual([
      "dQw4w9WgXcQ",
      "aaaaaaaaaaa",
    ]);
  });

  it("ignores links inline within prose (they don't become players)", () => {
    expect(
      embeddedYouTubeIds(
        "Watch https://www.youtube.com/watch?v=dQw4w9WgXcQ now.",
      ),
    ).toEqual([]);
  });

  it("ignores non-YouTube standalone links", () => {
    expect(embeddedYouTubeIds("https://example.com/watch?v=dQw4w9WgXcQ")).toEqual(
      [],
    );
  });
});

describe("buildYouTubeSystemText", () => {
  it("is empty when the plugin is disabled", () => {
    expect(buildYouTubeSystemText(registry([]))).toBe("");
    expect(buildYouTubeSystemText(registry(["mermaid"]))).toBe("");
  });

  it("returns the instruction when the youtube renderer is enabled", () => {
    const out = buildYouTubeSystemText(registry(["youtube"]));
    expect(out).toContain("## YouTube videos");
    expect(out).toContain("own line");
  });
});
