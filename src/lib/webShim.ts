// Web-only shim: installs Tauri's browser IPC/window mocks so the frontend runs
// in a plain browser with NO Rust backend. Imported FIRST in main.tsx (before
// any getCurrentWindow() call). All Rust commands are stubbed here; the SQLite
// layer is faked separately at the getDb() seam (lib/webdb.ts). The one command
// with real behaviour is `chat_stream`, which is simulated so the actual
// streaming → store → MessageList path runs (that's what we debug here).
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { WEB_ONLY } from "@/lib/webOnly";

// The built-in plugin manifests (providers + renderers), the same JSON the Rust
// backend seeds `list_plugins` from. Returning these (rather than []) keeps the
// real providers (Anthropic/OpenAI/…) available so Send isn't disabled. Bundled
// at build time via Vite's glob; each value is the parsed JSON object.
const builtinManifests = import.meta.glob(
  "/src-tauri/src/plugins/builtin/*.json",
  { eager: true, import: "default" },
);
const BUILTIN_PLUGINS = Object.values(builtinManifests)
  .map((manifest) => ({
    enabled:
      (manifest as { enabledByDefault?: boolean }).enabledByDefault ?? true,
    manifest,
  }))
  // Ollama needs a local daemon that doesn't exist in the browser — drop it so
  // web mode defaults to a cloud provider instead of an unreachable local one.
  .filter((p) => (p.manifest as { id?: string }).id !== "com.snak.ollama");

const SIM_REPLY = [
  "Sure — here's a simulated streaming reply so you can watch the chat scroll.",
  "",
  "It arrives in small chunks on a timer, exactly like a real provider stream,",
  "so the message row grows in place and the view should stay pinned to the",
  "bottom while you're parked there.",
  "",
  "Paragraph three keeps going for a while to make the reply tall enough that it",
  "overflows the viewport: lorem ipsum dolor sit amet, consectetur adipiscing",
  "elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  "",
  "```ts",
  "// a code block, to vary row height",
  "function follow(el: HTMLElement) {",
  "  el.scrollTop = el.scrollHeight;",
  "}",
  "```",
  "",
  "And a final paragraph so there's clearly more content than fits on screen,",
  "letting you confirm the auto-follow tracks the bottom as text streams in.",
].join("\n");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function simulateStream(args: unknown): Promise<unknown> {
  const channel = (args as { onDelta?: { onmessage?: (e: unknown) => void } })
    ?.onDelta;
  const emit = (e: unknown) => {
    try {
      channel?.onmessage?.(e);
    } catch {
      /* channel not wired the way we expect — ignore */
    }
  };
  const step = 12;
  for (let i = 0; i < SIM_REPLY.length; i += step) {
    emit({ text: SIM_REPLY.slice(i, i + step) });
    await sleep(45);
  }
  return {
    content: SIM_REPLY,
    model: (args as { model?: string })?.model ?? "claude-opus-4-8",
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
    },
  };
}

if (WEB_ONLY) {
  mockWindows("main");
  const stubbed = new Set<string>();
  mockIPC(async (cmd, args) => {
    try {
      if (cmd === "chat_stream") return await simulateStream(args);
      if (cmd === "has_api_key") return true;
      // probeConnectivity() destructures `{ online }` — must be an object.
      if (cmd === "connectivity_probe") return { online: true };
      if (cmd === "list_plugins") return BUILTIN_PLUGINS;
      // McpToolsReport shape: `{ tools, errors }` (the hashtag palette and the
      // settings card both read `.tools`). No tools in web-only mode.
      if (cmd === "mcp_list_tools") return { tools: [], errors: [] };
      if (cmd.startsWith("list_")) return [];
      // Everything else (writes, window/tray, screenshots, audio, ollama, …) is
      // a no-op in the browser. Log once per command so it's visible in devtools.
      if (!stubbed.has(cmd)) {
        stubbed.add(cmd);
        console.info(`[web-only] stubbed Rust command: ${cmd}`);
      }
      return null;
    } catch (e) {
      console.error(`[web-only] handler error for "${cmd}"`, e);
      return null;
    }
  });
  console.info(
    "%c[web-only] Tauri backend mocked — running as a web app.",
    "color:#0a0;font-weight:bold",
  );
}
