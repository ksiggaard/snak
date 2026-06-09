import { describe, expect, it } from "vitest";
import {
  BUILTIN_WEB_SERVER,
  parseServers,
  withBuiltin,
  type McpServer,
} from "@/lib/mcp";

const custom: McpServer = {
  id: "github",
  label: "GitHub",
  transport: "http",
  url: "https://example.com/mcp",
  enabled: true,
};

describe("withBuiltin", () => {
  it("prepends the built-in web server when absent", () => {
    const out = withBuiltin([custom]);
    expect(out[0].id).toBe(BUILTIN_WEB_SERVER.id);
    expect(out[0].enabled).toBe(true);
    expect(out[0].builtin).toBe(true);
    expect(out).toHaveLength(2);
  });

  it("preserves a toggled-off built-in and de-dupes it", () => {
    const out = withBuiltin([
      { ...BUILTIN_WEB_SERVER, enabled: false },
      custom,
    ]);
    expect(out.filter((s) => s.id === BUILTIN_WEB_SERVER.id)).toHaveLength(1);
    expect(out[0].enabled).toBe(false);
    expect(out[0].builtin).toBe(true);
  });
});

describe("parseServers", () => {
  it("returns just the built-in for null/empty", () => {
    expect(parseServers(null)).toEqual([
      { ...BUILTIN_WEB_SERVER, enabled: true },
    ]);
  });

  it("ignores malformed JSON and non-arrays", () => {
    expect(parseServers("not json")[0].id).toBe(BUILTIN_WEB_SERVER.id);
    expect(parseServers("{}")[0].id).toBe(BUILTIN_WEB_SERVER.id);
    expect(parseServers("{}")).toHaveLength(1);
  });

  it("round-trips a custom server and keeps the built-in first", () => {
    const raw = JSON.stringify([custom]);
    const out = parseServers(raw);
    expect(out[0].id).toBe(BUILTIN_WEB_SERVER.id);
    expect(out[1]).toMatchObject({ id: "github", transport: "http" });
  });

  it("drops entries missing required fields", () => {
    const raw = JSON.stringify([{ label: "no id" }, custom]);
    const out = parseServers(raw);
    // built-in + the one valid custom server
    expect(out).toHaveLength(2);
    expect(out[1].id).toBe("github");
  });
});
