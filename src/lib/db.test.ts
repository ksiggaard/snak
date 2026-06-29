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
        protocol: "openai",
        baseUrl: "https://api.groq.com/openai/v1",
        defaultModel: "llama-3.3",
      },
    ]);
  });

  it("defaults a missing label to the id, missing model to empty, missing protocol to openai", () => {
    const out = parseCustomProviders(
      JSON.stringify([{ id: "local", baseUrl: "http://localhost:1234/v1" }]),
    );
    expect(out).toEqual([
      {
        id: "local",
        label: "local",
        protocol: "openai",
        baseUrl: "http://localhost:1234/v1",
        defaultModel: "",
      },
    ]);
  });

  it("keeps a valid protocol and coerces an unknown one to openai", () => {
    const out = parseCustomProviders(
      JSON.stringify([
        { id: "a", baseUrl: "https://a", protocol: "anthropic" },
        { id: "g", baseUrl: "https://g", protocol: "gemini" },
        { id: "x", baseUrl: "https://x", protocol: "bogus" },
        { id: "y", baseUrl: "https://y" },
      ]),
    );
    expect(out.map((p) => p.protocol)).toEqual([
      "anthropic",
      "gemini",
      "openai",
      "openai",
    ]);
  });
});
