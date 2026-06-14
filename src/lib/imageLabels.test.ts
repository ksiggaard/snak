import { describe, it, expect } from "vitest";
import { imageLabel, imageLabelOffsets } from "@/lib/imageLabels";

describe("imageLabel", () => {
  it("maps the first 26 indices to A–Z", () => {
    expect(imageLabel(0)).toBe("A");
    expect(imageLabel(1)).toBe("B");
    expect(imageLabel(25)).toBe("Z");
  });

  it("rolls over to two letters after Z", () => {
    expect(imageLabel(26)).toBe("AA");
    expect(imageLabel(27)).toBe("AB");
    expect(imageLabel(51)).toBe("AZ");
    expect(imageLabel(52)).toBe("BA");
  });
});

describe("imageLabelOffsets", () => {
  it("returns the running count of images before each message", () => {
    const messages = [
      { images: [1, 2] }, // A, B
      { images: [] },
      { images: [1] }, // C
      {}, // no images field
      { images: [1, 2] }, // D, E
    ];
    expect(imageLabelOffsets(messages)).toEqual([0, 2, 2, 3, 3]);
  });

  it("is stable: appending a later message never shifts earlier offsets", () => {
    const base = [{ images: [1, 2] }, { images: [1] }];
    const grown = [...base, { images: [1, 1] }];
    expect(imageLabelOffsets(grown).slice(0, 2)).toEqual(
      imageLabelOffsets(base),
    );
  });
});
