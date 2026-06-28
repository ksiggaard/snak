import { describe, it, expect } from "vitest";
import {
  availableOutputTypes,
  buildOutputTypeSystemText,
  DEFAULT_OUTPUT_TYPE,
  OUTPUT_TYPES,
  type OutputTypeId,
} from "@/lib/outputTypes";
import type { HostRegistry } from "@/lib/plugins";

const registry = (languages: string[]): HostRegistry => ({
  providers: [],
  themes: [],
  slashCommands: [],
  renderers: languages.map((language) => ({ language })),
  audio: [],
});

describe("buildOutputTypeSystemText", () => {
  it("injects nothing for the default type", () => {
    expect(buildOutputTypeSystemText("default", registry([]))).toBe("");
    expect(buildOutputTypeSystemText(DEFAULT_OUTPUT_TYPE, registry([]))).toBe("");
  });

  it("injects nothing for an unknown id (graceful no-op)", () => {
    expect(buildOutputTypeSystemText("nope", registry([]))).toBe("");
  });

  it("returns the instruction for a built-in type", () => {
    expect(buildOutputTypeSystemText("json", registry([]))).toContain("JSON");
    expect(buildOutputTypeSystemText("flat", registry([]))).toContain(
      "plain text",
    );
  });

  it("gates artefact on the artifact renderer being enabled", () => {
    expect(buildOutputTypeSystemText("artefact", registry([]))).toBe("");
    expect(buildOutputTypeSystemText("artefact", registry(["mermaid"]))).toBe("");
    expect(
      buildOutputTypeSystemText("artefact", registry(["artifact"])),
    ).toContain("artifact");
  });
});

describe("availableOutputTypes", () => {
  it("omits artefact when the artifact renderer is disabled", () => {
    const ids = availableOutputTypes(registry([])).map((o) => o.id);
    expect(ids).toContain("default");
    expect(ids).not.toContain("artefact");
  });

  it("includes artefact when the artifact renderer is enabled", () => {
    const ids = availableOutputTypes(registry(["artifact"])).map((o) => o.id);
    expect(ids).toContain("artefact");
  });
});

describe("OUTPUT_TYPES catalogue", () => {
  it("has unique ids and a default-first ordering", () => {
    const ids = OUTPUT_TYPES.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe<OutputTypeId>("default");
  });
});
