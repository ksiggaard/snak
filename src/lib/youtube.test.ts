import { describe, it, expect } from "vitest";
import {
  buildYouTubeSystemText,
  buildYoutubeMarkdown,
  youtubeFileName,
  embeddedYouTubeIds,
  mediaLabelOffsets,
  parseYouTubeUrl,
  partitionVideoThumbs,
  youTubeEmbedSrc,
  YOUTUBE_SUMMARY_SYSTEM_PROMPT,
} from "@/lib/youtube";
import type { HostRegistry } from "@/lib/plugins";

const registry = (languages: string[]): HostRegistry => ({
  providers: [],
  themes: [],
  slashCommands: [],
  renderers: languages.map((language) => ({ language })),
  audio: [],
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

const yt = (id: string) => ({
  media_type: "image/jpeg",
  data: "x",
  source: `https://youtu.be/${id}`,
});
const pic = () => ({
  media_type: "image/jpeg",
  data: "x",
  source: "https://example.com/a.jpg",
});

describe("partitionVideoThumbs", () => {
  it("splits YouTube-source images out as videos when enabled", () => {
    const { images, videoThumbs } = partitionVideoThumbs(
      [pic(), yt("dQw4w9WgXcQ")],
      true,
    );
    expect(images).toHaveLength(1);
    expect(videoThumbs).toHaveLength(1);
    expect(videoThumbs[0].source).toContain("youtu.be");
  });

  it("treats everything as images when disabled", () => {
    const { images, videoThumbs } = partitionVideoThumbs(
      [yt("dQw4w9WgXcQ"), pic()],
      false,
    );
    expect(images).toHaveLength(2);
    expect(videoThumbs).toHaveLength(0);
  });
});

describe("mediaLabelOffsets", () => {
  it("counts images and videos as independent sequences when enabled", () => {
    const messages = [
      { images: [pic(), yt("aaaaaaaaaaa")] },
      { images: [yt("bbbbbbbbbbb")] },
      { images: [pic()] },
    ];
    expect(mediaLabelOffsets(messages, true)).toEqual({
      imageOffsets: [0, 1, 1],
      videoOffsets: [0, 1, 2],
    });
  });

  it("counts everything as images when disabled", () => {
    const messages = [{ images: [yt("aaaaaaaaaaa"), pic()] }, { images: [] }];
    expect(mediaLabelOffsets(messages, false)).toEqual({
      imageOffsets: [0, 2],
      videoOffsets: [0, 0],
    });
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

// ---------------------------------------------------------------------------
// T60 — buildYoutubeMarkdown, youtubeFileName, YOUTUBE_SUMMARY_SYSTEM_PROMPT
// ---------------------------------------------------------------------------

describe("buildYoutubeMarkdown", () => {
  const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  const title = "Rick Astley - Never Gonna Give You Up";
  const summary = "## Overview\n\nA classic pop anthem.";
  const date = "2026-06-17";

  it("includes the T59 source + fetched front-matter comments", () => {
    const md = buildYoutubeMarkdown(url, title, summary, date);
    expect(md).toContain(`<!-- source: ${url} -->`);
    expect(md).toContain(`<!-- fetched: ${date} -->`);
  });

  it("includes a level-1 heading with the video title", () => {
    const md = buildYoutubeMarkdown(url, title, summary, date);
    expect(md).toContain(`# ${title}`);
  });

  it("includes the summary body", () => {
    const md = buildYoutubeMarkdown(url, title, summary, date);
    expect(md).toContain("A classic pop anthem.");
  });

  it("falls back to 'YouTube video' when title is empty", () => {
    const md = buildYoutubeMarkdown(url, "", summary, date);
    expect(md).toContain("# YouTube video");
  });

  it("produces the comments before the heading", () => {
    const md = buildYoutubeMarkdown(url, title, summary, date);
    const commentEnd = md.indexOf("-->\n\n#");
    expect(commentEnd).toBeGreaterThan(0);
  });
});

describe("youtubeFileName", () => {
  it("sanitises the title into a .md filename", () => {
    const name = youtubeFileName("Rick Astley: Never Gonna Give You Up", "https://youtu.be/dQw4w9WgXcQ");
    expect(name).toMatch(/\.md$/);
    expect(name).not.toContain(":");
  });

  it("falls back to the hostname when title is empty", () => {
    const name = youtubeFileName("", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(name).toMatch(/\.md$/);
    expect(name.length).toBeGreaterThan(3);
  });

  it("truncates very long titles", () => {
    const longTitle = "A".repeat(200);
    const name = youtubeFileName(longTitle, "https://youtu.be/dQw4w9WgXcQ");
    // Base name capped at 80 + ".md" = 83
    expect(name.length).toBeLessThanOrEqual(83);
  });
});

describe("YOUTUBE_SUMMARY_SYSTEM_PROMPT", () => {
  it("is a non-empty string", () => {
    expect(typeof YOUTUBE_SUMMARY_SYSTEM_PROMPT).toBe("string");
    expect(YOUTUBE_SUMMARY_SYSTEM_PROMPT.length).toBeGreaterThan(20);
  });
});
