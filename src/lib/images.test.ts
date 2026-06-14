import { describe, expect, it } from "vitest";
import { fitSvg, withSvgBackground } from "@/lib/images";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50"><g><rect x="10" y="10" width="5" height="5"/></g></svg>`;

describe("withSvgBackground", () => {
  it("inserts an opaque rect as the first child sized to the viewBox", () => {
    const out = withSvgBackground(SVG, "rgb(20, 55, 75)");
    const doc = new DOMParser().parseFromString(out, "image/svg+xml");
    const first = doc.documentElement.firstElementChild;
    expect(first?.nodeName.toLowerCase()).toBe("rect");
    expect(first?.getAttribute("fill")).toBe("rgb(20, 55, 75)");
    expect(first?.getAttribute("width")).toBe("100");
    expect(first?.getAttribute("height")).toBe("50");
    // original content is preserved (the <g> is still present, after the rect).
    expect(doc.querySelector("g")).not.toBeNull();
  });

  it("falls back to 100% coverage when there is no viewBox", () => {
    const noViewBox = `<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>`;
    const out = withSvgBackground(noViewBox, "#fff");
    const doc = new DOMParser().parseFromString(out, "image/svg+xml");
    const rect = doc.documentElement.firstElementChild;
    expect(rect?.getAttribute("width")).toBe("100%");
    expect(rect?.getAttribute("height")).toBe("100%");
  });

  it("returns the input unchanged when it is not an SVG", () => {
    expect(withSvgBackground("not svg", "#fff")).toBe("not svg");
  });
});

describe("fitSvg", () => {
  it("makes the svg fill its container and preserves aspect ratio", () => {
    const out = fitSvg(SVG);
    const el = new DOMParser().parseFromString(out, "image/svg+xml")
      .documentElement;
    expect(el.getAttribute("width")).toBe("100%");
    expect(el.getAttribute("height")).toBe("100%");
    expect(el.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
  });

  it("bakes in a background rect when bg is given", () => {
    const out = fitSvg(SVG, "rgb(1, 2, 3)");
    const doc = new DOMParser().parseFromString(out, "image/svg+xml");
    const first = doc.documentElement.firstElementChild;
    expect(first?.nodeName.toLowerCase()).toBe("rect");
    expect(first?.getAttribute("fill")).toBe("rgb(1, 2, 3)");
  });
});
