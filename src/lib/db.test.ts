import { describe, it, expect } from "vitest";
import { parseCustomProviders } from "@/lib/db";

describe("parseCustomProviders (tolerant parse)", () => {
  it("returns [] for null / empty / non-JSON / non-array", () => {
    expect(parseCustomProviders(null)).toEqual([]);
    expect(parseCustomProviders("")).toEqual([]);
    expect(parseCustomProviders("not json")).toEqual([]);
    expect(parseCustomProviders('{"id":"x"}')).toEqual([]);
  });

  it("keeps well-formed entries and drops ones missing id or baseUrl", () => {
    const raw = JSON.stringify([
      {
        id: "groq",
        label: "Groq",
        baseUrl: "https://api.groq.com/openai/v1",
        defaultModel: "llama-3.3",
      },
      { id: "", baseUrl: "https://x" }, // empty id → dropped
      { id: "nourl", baseUrl: "" }, // empty baseUrl → dropped
      { label: "no id", baseUrl: "https://y" }, // missing id → dropped
    ]);
    const out = parseCustomProviders(raw);
    expect(out).toEqual([
      {
        id: "groq",
        label: "Groq",
        baseUrl: "https://api.groq.com/openai/v1",
        defaultModel: "llama-3.3",
      },
    ]);
  });

  it("defaults a missing label to the id and a missing model to empty string", () => {
    const out = parseCustomProviders(
      JSON.stringify([{ id: "local", baseUrl: "http://localhost:1234/v1" }]),
    );
    expect(out).toEqual([
      {
        id: "local",
        label: "local",
        baseUrl: "http://localhost:1234/v1",
        defaultModel: "",
      },
    ]);
  });
});
