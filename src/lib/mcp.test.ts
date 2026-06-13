import { describe, expect, it } from "vitest";
import {
  BUILTIN_SERVERS,
  BUILTIN_SYSDEBUG_SERVER,
  BUILTIN_WEB_SERVER,
  gateServersForChat,
  parseServers,
  withBuiltins,
  type McpServer,
} from "@/lib/mcp";

const custom: McpServer = {
  id: "github",
  label: "GitHub",
  transport: "http",
  url: "https://example.com/mcp",
  enabled: true,
};

const N_BUILTINS = BUILTIN_SERVERS.length; // web + sys

describe("withBuiltins", () => {
  it("prepends every built-in (with default enabled state) when absent", () => {
    const out = withBuiltins([custom]);
    expect(out[0].id).toBe(BUILTIN_WEB_SERVER.id);
    expect(out[0].enabled).toBe(true);
    expect(out[1].id).toBe(BUILTIN_SYSDEBUG_SERVER.id);
    // The system-diagnostics server is disabled by default.
    expect(out[1].enabled).toBe(false);
    expect(out.every((s, i) => (i < N_BUILTINS ? s.builtin : true))).toBe(true);
    expect(out).toHaveLength(N_BUILTINS + 1);
  });

  it("preserves a toggled built-in state and de-dupes it", () => {
    const out = withBuiltins([
      { ...BUILTIN_WEB_SERVER, enabled: false },
      { ...BUILTIN_SYSDEBUG_SERVER, enabled: true },
      custom,
    ]);
    expect(out.filter((s) => s.id === BUILTIN_WEB_SERVER.id)).toHaveLength(1);
    expect(out.filter((s) => s.id === BUILTIN_SYSDEBUG_SERVER.id)).toHaveLength(
      1,
    );
    expect(out[0].enabled).toBe(false); // web toggled off, kept
    expect(out[1].enabled).toBe(true); // sys toggled on, kept
    expect(out[0].builtin).toBe(true);
    expect(out[1].builtin).toBe(true);
  });
});

describe("parseServers", () => {
  it("returns just the built-ins for null/empty", () => {
    expect(parseServers(null)).toEqual([
      { ...BUILTIN_WEB_SERVER, enabled: true },
      { ...BUILTIN_SYSDEBUG_SERVER, enabled: false },
    ]);
  });

  it("ignores malformed JSON and non-arrays", () => {
    expect(parseServers("not json")[0].id).toBe(BUILTIN_WEB_SERVER.id);
    expect(parseServers("{}")[0].id).toBe(BUILTIN_WEB_SERVER.id);
    expect(parseServers("{}")).toHaveLength(N_BUILTINS);
  });

  it("round-trips a custom server and keeps the built-ins first", () => {
    const raw = JSON.stringify([custom]);
    const out = parseServers(raw);
    expect(out[0].id).toBe(BUILTIN_WEB_SERVER.id);
    expect(out[1].id).toBe(BUILTIN_SYSDEBUG_SERVER.id);
    expect(out[N_BUILTINS]).toMatchObject({ id: "github", transport: "http" });
  });

  it("drops entries missing required fields", () => {
    const raw = JSON.stringify([{ label: "no id" }, custom]);
    const out = parseServers(raw);
    // built-ins + the one valid custom server
    expect(out).toHaveLength(N_BUILTINS + 1);
    expect(out[N_BUILTINS].id).toBe("github");
  });
});

describe("gateServersForChat", () => {
  const web = { ...BUILTIN_WEB_SERVER, enabled: true };
  const sys = { ...BUILTIN_SYSDEBUG_SERVER, enabled: true };

  it("drops disabled servers", () => {
    const out = gateServersForChat(
      [{ ...web, enabled: false }, sys],
      true,
      true,
    );
    expect(out.map((s) => s.id)).toEqual(["sys"]);
  });

  it("keeps the sys server for local providers", () => {
    const out = gateServersForChat([web, sys], true, false);
    expect(out.map((s) => s.id)).toContain("sys");
  });

  it("drops the sys server for cloud providers without opt-in", () => {
    const out = gateServersForChat([web, sys], false, false);
    expect(out.map((s) => s.id)).toEqual(["web"]);
  });

  it("keeps the sys server for cloud providers once opted in", () => {
    const out = gateServersForChat([web, sys], false, true);
    expect(out.map((s) => s.id)).toContain("sys");
  });

  it("never gates non-sys servers on provider locality", () => {
    const out = gateServersForChat([web], false, false);
    expect(out.map((s) => s.id)).toEqual(["web"]);
  });
});
