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
import { isKeylessProvider } from "@/lib/providers";
import type { Provider } from "@/types/db";

/** Settings key under which the server list JSON is persisted. */
export const MCP_SERVERS_KEY = "mcp_servers";

/**
 * Settings key for the opt-in that lets the read-only system-diagnostics server
 * be used with **cloud** providers (off by default). Local models (Ollama) can
 * always use it — their data never leaves the machine — so this only governs
 * sending system data to a third-party cloud provider.
 */
export const ALLOW_CLOUD_SYS_TOOLS_KEY = "allow_cloud_sys_tools";

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
 * The built-in, read-only system-diagnostics server (`sys`). Ships **disabled** —
 * it lets the model read files/dirs, owners & permissions, and run read-only
 * diagnostics (processes, disk, network, sensors…), and every call is gated
 * behind an explicit per-call approval. It can never modify anything. Approved
 * output (including file contents) is sent to your model provider.
 */
export const BUILTIN_SYSDEBUG_SERVER: McpServer = {
  id: "sys",
  label: "System diagnostics (read-only, built-in)",
  transport: "builtin",
  enabled: false,
  builtin: true,
};

/** All built-in servers, in display order (always present, never removable). */
export const BUILTIN_SERVERS: McpServer[] = [
  BUILTIN_WEB_SERVER,
  BUILTIN_SYSDEBUG_SERVER,
];

/**
 * Ensure every built-in server is present exactly once and first, in declared
 * order. User config may persist a toggled built-in entry (we keep its
 * `enabled`), but never a duplicate or a removed one. Pure — unit-tested.
 */
export function withBuiltins(servers: McpServer[]): McpServer[] {
  const builtins = BUILTIN_SERVERS.map((b) => {
    const existing = servers.find((s) => s.id === b.id);
    return { ...b, enabled: existing ? existing.enabled : b.enabled };
  });
  const builtinIds = new Set(BUILTIN_SERVERS.map((b) => b.id));
  const rest = servers.filter((s) => !builtinIds.has(s.id));
  return [...builtins, ...rest];
}

/** Parse the persisted JSON into a server list, tolerating absent/malformed
 * values. Always includes the built-in. Pure — unit-tested. */
export function parseServers(raw: string | null): McpServer[] {
  if (!raw) return withBuiltins([]);
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return withBuiltins([]);
    const servers = parsed.filter(
      (s): s is McpServer =>
        s && typeof s.id === "string" && typeof s.transport === "string",
    );
    return withBuiltins(servers);
  } catch {
    return withBuiltins([]);
  }
}

/** Load the configured servers from settings (built-in always present). */
export async function loadServers(): Promise<McpServer[]> {
  return parseServers(await getSetting(MCP_SERVERS_KEY));
}

/** Persist the server list (the built-in is normalized in on read). */
export async function saveServers(servers: McpServer[]): Promise<void> {
  await setSetting(MCP_SERVERS_KEY, JSON.stringify(withBuiltins(servers)));
}

/** Whether system diagnostics may run with cloud providers (opt-in, default off). */
export async function loadAllowCloudSysTools(): Promise<boolean> {
  return (await getSetting(ALLOW_CLOUD_SYS_TOOLS_KEY)) === "true";
}

/** Persist the cloud opt-in for system diagnostics. */
export async function setAllowCloudSysTools(allow: boolean): Promise<void> {
  await setSetting(ALLOW_CLOUD_SYS_TOOLS_KEY, allow ? "true" : "false");
}

/**
 * The enabled servers to hand to `chat_stream` for a given provider. Returns
 * `undefined` when nothing applies, so the backend sends no tools and the chat
 * path is byte-identical to the no-MCP behavior. Read inside `chatStream` so the
 * store's `send()` call site stays unchanged.
 *
 * The read-only system-diagnostics server (`sys`) is **provider-gated**: it is
 * available with local models (Ollama) always, but with a cloud provider only
 * when the user has explicitly opted in — otherwise the system data it reads
 * would be sent off-machine to a third party. Local-by-default; cloud on opt-in.
 */
export async function enabledServersForChat(
  provider: Provider,
): Promise<McpServer[] | undefined> {
  const local = isKeylessProvider(provider);
  const allowCloudSys = local ? true : await loadAllowCloudSysTools();
  const enabled = gateServersForChat(await loadServers(), local, allowCloudSys);
  return enabled.length > 0 ? enabled : undefined;
}

/**
 * The enabled-server gate: keep enabled servers, but drop the read-only system-
 * diagnostics server (`sys`) for cloud providers unless the user opted in. Local
 * providers always keep it (data stays on the machine). Pure — unit-tested.
 */
export function gateServersForChat(
  servers: McpServer[],
  local: boolean,
  allowCloudSys: boolean,
): McpServer[] {
  return servers.filter((s) => {
    if (!s.enabled) return false;
    if (s.id === BUILTIN_SYSDEBUG_SERVER.id && !local && !allowCloudSys) {
      return false;
    }
    return true;
  });
}

/** List the tools the given servers expose (settings "refresh/test"). */
export function listTools(servers: McpServer[]): Promise<McpListedTool[]> {
  return invoke("mcp_list_tools", { servers });
}
