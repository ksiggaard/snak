import { describe, expect, it } from "vitest";
import {
  BUILTIN_DEVICE_SERVER,
  BUILTIN_SERVERS,
  BUILTIN_SYSDEBUG_SERVER,
  BUILTIN_WEB_SERVER,
  BUILTIN_YOUTUBE_SERVER,
  formatEnvText,
  gateServersForChat,
  gateServersForOffline,
  parseEnvText,
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

const N_BUILTINS = BUILTIN_SERVERS.length; // web + youtube + sys + device

describe("withBuiltins", () => {
  it("prepends every built-in (with default enabled state) when absent", () => {
    const out = withBuiltins([custom]);
    expect(out[0].id).toBe(BUILTIN_WEB_SERVER.id);
    expect(out[0].enabled).toBe(true);
    expect(out[1].id).toBe(BUILTIN_YOUTUBE_SERVER.id);
    // YouTube ships enabled (keyless, works out of the box).
    expect(out[1].enabled).toBe(true);
    expect(out[2].id).toBe(BUILTIN_SYSDEBUG_SERVER.id);
    // The system-diagnostics server is disabled by default.
    expect(out[2].enabled).toBe(false);
    expect(out.every((s, i) => (i < N_BUILTINS ? s.builtin : true))).toBe(true);
    expect(out).toHaveLength(N_BUILTINS + 1);
  });

  it("preserves a toggled built-in state and de-dupes it", () => {
    const out = withBuiltins([
      { ...BUILTIN_WEB_SERVER, enabled: false },
      { ...BUILTIN_SYSDEBUG_SERVER, enabled: true },
      custom,
    ]);
    // Order-independent: each built-in appears exactly once with its toggled
    // (or default) state, regardless of where it sits in the declared order.
    const find = (id: string) => out.filter((s) => s.id === id);
    expect(find(BUILTIN_WEB_SERVER.id)).toHaveLength(1);
    expect(find(BUILTIN_YOUTUBE_SERVER.id)).toHaveLength(1);
    expect(find(BUILTIN_SYSDEBUG_SERVER.id)).toHaveLength(1);
    expect(find(BUILTIN_WEB_SERVER.id)[0].enabled).toBe(false); // toggled off, kept
    expect(find(BUILTIN_SYSDEBUG_SERVER.id)[0].enabled).toBe(true); // toggled on, kept
    expect(find(BUILTIN_YOUTUBE_SERVER.id)[0].enabled).toBe(true); // default
    expect(find(BUILTIN_WEB_SERVER.id)[0].builtin).toBe(true);
    expect(find(BUILTIN_SYSDEBUG_SERVER.id)[0].builtin).toBe(true);
  });
});

describe("parseServers", () => {
  it("returns just the built-ins for null/empty", () => {
    expect(parseServers(null)).toEqual([
      { ...BUILTIN_WEB_SERVER, enabled: true },
      { ...BUILTIN_YOUTUBE_SERVER, enabled: true },
      { ...BUILTIN_SYSDEBUG_SERVER, enabled: false },
      { ...BUILTIN_DEVICE_SERVER, enabled: true },
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
    expect(out[1].id).toBe(BUILTIN_YOUTUBE_SERVER.id);
    expect(out[2].id).toBe(BUILTIN_SYSDEBUG_SERVER.id);
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

describe("gateServersForOffline", () => {
  const web = { ...BUILTIN_WEB_SERVER, enabled: true };
  const youtube = { ...BUILTIN_YOUTUBE_SERVER, enabled: true };
  const sys = { ...BUILTIN_SYSDEBUG_SERVER, enabled: true };
  const httpCustom: McpServer = {
    id: "github",
    label: "GitHub",
    transport: "http",
    url: "https://example.com/mcp",
    enabled: true,
  };
  const stdioCustom: McpServer = {
    id: "local-tool",
    label: "Local tool",
    transport: "stdio",
    command: "my-tool",
    enabled: true,
  };

  it("is a no-op when online", () => {
    const all = [web, youtube, sys, httpCustom, stdioCustom];
    expect(gateServersForOffline(all, false)).toEqual(all);
  });

  it("drops web + youtube but keeps the local sys server when offline", () => {
    const out = gateServersForOffline([web, youtube, sys], true);
    expect(out.map((s) => s.id)).toEqual(["sys"]);
  });

  it("drops remote http custom servers but keeps local stdio ones when offline", () => {
    const out = gateServersForOffline([httpCustom, stdioCustom], true);
    expect(out.map((s) => s.id)).toEqual(["local-tool"]);
  });
});

describe("env text helpers", () => {
  it("parses KEY=value lines, ignoring blanks and comments", () => {
    expect(parseEnvText("A=1\nB=two words\n\n# a comment\nNOEQUALS")).toEqual({
      A: "1",
      B: "two words",
    });
  });

  it("trims the key and keeps everything after the first = as the value", () => {
    expect(parseEnvText("  TOKEN = ab=cd ")).toEqual({ TOKEN: "ab=cd" });
  });

  it("formats a record back to sorted KEY=value lines", () => {
    expect(formatEnvText({ B: "2", A: "1" })).toBe("A=1\nB=2");
  });

  it("round-trips through parseServers via the env field", () => {
    const json = JSON.stringify([
      { id: "fx", label: "FF", transport: "stdio", command: "npx -y fx", enabled: true, env: { A: "1" } },
    ]);
    const out = parseServers(json).find((s) => s.id === "fx");
    expect(out?.env).toEqual({ A: "1" });
  });
});
