import { describe, it, expect } from "vitest";
import { imageDataUrl, type MessageImage } from "@/lib/messages";

describe("imageDataUrl", () => {
  it("formats a base64 image as a data URL", () => {
    const img: MessageImage = { media_type: "image/jpeg", data: "AAAA" };
    expect(imageDataUrl(img)).toBe("data:image/jpeg;base64,AAAA");
  });

  it("preserves the media type for PNGs", () => {
    const img: MessageImage = { media_type: "image/png", data: "QkM=" };
    expect(imageDataUrl(img)).toBe("data:image/png;base64,QkM=");
  });

  it("handles an empty payload", () => {
    const img: MessageImage = { media_type: "image/webp", data: "" };
    expect(imageDataUrl(img)).toBe("data:image/webp;base64,");
  });
});
