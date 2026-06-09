import { describe, it, expect } from "vitest";
import { scaledDimensions } from "@/lib/image";

describe("scaledDimensions", () => {
  it("leaves an image smaller than maxDim untouched (no upscaling)", () => {
    expect(scaledDimensions(800, 600, 1568)).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("clamps scale to 1 when the longer side equals maxDim", () => {
    expect(scaledDimensions(1568, 900, 1568)).toEqual({
      width: 1568,
      height: 900,
    });
  });

  it("downscales by the longer (width) side", () => {
    // scale = 1568/3136 = 0.5
    expect(scaledDimensions(3136, 2000, 1568)).toEqual({
      width: 1568,
      height: 1000,
    });
  });

  it("downscales by the longer (height) side", () => {
    // scale = 1568/3136 = 0.5
    expect(scaledDimensions(2000, 3136, 1568)).toEqual({
      width: 1000,
      height: 1568,
    });
  });

  it("rounds non-integer scaled dimensions", () => {
    // scale = 100/300 = 0.3333…; 200*0.3333 = 66.66 -> 67
    expect(scaledDimensions(300, 200, 100)).toEqual({
      width: 100,
      height: 67,
    });
  });

  it("handles a square image", () => {
    expect(scaledDimensions(4000, 4000, 1568)).toEqual({
      width: 1568,
      height: 1568,
    });
  });
});
