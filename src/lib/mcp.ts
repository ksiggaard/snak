// MCP (Model Context Protocol) configuration — frontend.
//
// The Rust backend owns the MCP *client* (connecting to servers, listing/calling
// tools) and runs the tool-call round-trip inside `chat_stream`. The frontend
// owns the *config* (which servers exist + are enabled), persisted in the
// `settings` table per the Stage-1 "frontend owns the DB" rule, and passes the
// enabled list into `chat_stream` so the backend can build the tool set.
//
// The built-in web-browse server (`web`) is a synthetic, always-present entry:
// it's enabled by default, works with no external setup, and can be toggled but
// not removed. Custom stdio/HTTP servers are added by the user.

import { invoke } from "@tauri-apps/api/core";
import { getSetting, setSetting } from "@/lib/db";

/** Settings key under which the server list JSON is persisted. */
export const MCP_SERVERS_KEY = "mcp_servers";

export type McpTransport = "builtin" | "stdio" | "http";

export interface McpServer {
  /** Stable id; also the tool namespace prefix (`<id>__<tool>`). */
  id: string;
  /** Human label for the settings UI. */
  label: string;
  transport: McpTransport;
  /** For stdio: the command + args (whitespace-split). */
  command?: string;
  /** For http: the endpoint URL. */
  url?: string;
  enabled: boolean;
  /** Built-in servers can be toggled but not removed. */
  builtin?: boolean;
}

/** A tool exposed by a server, as returned by `mcp_list_tools`. */
export interface McpListedTool {
  server_id: string;
  name: string;
  description: string;
}

/** The always-present built-in web-browse server entry (enabled by default). */
export const BUILTIN_WEB_SERVER: McpServer = {
  id: "web",
  label: "Web browsing (built-in)",
  transport: "builtin",
  enabled: true,
  builtin: true,
};

/**
 * Ensure the built-in web server is present exactly once and first. User config
 * may persist a toggled-off built-in entry (we keep its `enabled`), but never a
 * duplicate or a removed one. Pure — unit-tested.
 */
export function withBuiltin(servers: McpServer[]): McpServer[] {
  const existing = servers.find((s) => s.id === BUILTIN_WEB_SERVER.id);
  const builtin: McpServer = {
    ...BUILTIN_WEB_SERVER,
    enabled: existing ? existing.enabled : BUILTIN_WEB_SERVER.enabled,
  };
  const rest = servers.filter((s) => s.id !== BUILTIN_WEB_SERVER.id);
  return [builtin, ...rest];
}

/** Parse the persisted JSON into a server list, tolerating absent/malformed
 * values. Always includes the built-in. Pure — unit-tested. */
export function parseServers(raw: string | null): McpServer[] {
  if (!raw) return withBuiltin([]);
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return withBuiltin([]);
    const servers = parsed.filter(
      (s): s is McpServer =>
        s && typeof s.id === "string" && typeof s.transport === "string",
    );
    return withBuiltin(servers);
  } catch {
    return withBuiltin([]);
  }
}

/** Load the configured servers from settings (built-in always present). */
export async function loadServers(): Promise<McpServer[]> {
  return parseServers(await getSetting(MCP_SERVERS_KEY));
}

/** Persist the server list (the built-in is normalized in on read). */
export async function saveServers(servers: McpServer[]): Promise<void> {
  await setSetting(MCP_SERVERS_KEY, JSON.stringify(withBuiltin(servers)));
}

/**
 * The enabled servers to hand to `chat_stream`. Returns `undefined` when no
 * server is enabled, so the backend sends no tools and the chat path is
 * byte-identical to the no-MCP behavior. Read inside `chatStream` so the store's
 * `send()` call site stays unchanged.
 */
export async function enabledServersForChat(): Promise<McpServer[] | undefined> {
  const enabled = (await loadServers()).filter((s) => s.enabled);
  return enabled.length > 0 ? enabled : undefined;
}

/** List the tools the given servers expose (settings "refresh/test"). */
export function listTools(servers: McpServer[]): Promise<McpListedTool[]> {
  return invoke("mcp_list_tools", { servers });
}
