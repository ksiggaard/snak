// Current-OS detection, shared by the MCP server list (hide the Unix-only
// sysdebug server on Windows) and the plugin registry (manifest `supportedOS`).

export type OS = "linux" | "macos" | "windows";

/** The OS values a plugin manifest's `supportedOS` may list. */
export const OS_VALUES: readonly OS[] = ["linux", "macos", "windows"];

/**
 * Best-effort current OS from the webview user-agent. ponytail: the WebView UA
 * always carries the platform, so no `@tauri-apps/plugin-os` dependency or async
 * call is needed. Falls back to "linux" when navigator is absent (e.g. a
 * non-jsdom test runner).
 */
export function currentOS(): OS {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (ua.includes("Windows")) return "windows";
  if (ua.includes("Mac")) return "macos";
  return "linux";
}
