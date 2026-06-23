// Mermaid renderer, as a real runtime plugin (migrated from the built-in
// CodeBlock branch). esbuild bundles mermaid's npm dep — including its lazily
// imported diagram types — into a single self-contained main.js for the loader.
//
// Streaming-safety (don't render partial diagrams mid-stream) is handled by the
// host's PluginRenderedBlock, so the mount only runs on final source. The
// click-to-enlarge lightbox of the old built-in is intentionally dropped (the
// plugin context doesn't expose it); the diagram still renders.

import type { PluginContext } from "@/types/pluginApi";
import mermaid from "mermaid";

function showSource(el: HTMLElement, code: string) {
  const pre = document.createElement("pre");
  pre.textContent = code;
  pre.className =
    "border-border bg-background/60 my-2 overflow-x-auto rounded-md border p-3 font-mono text-xs";
  el.replaceChildren(pre);
}

export function activate(ctx: PluginContext) {
  ctx.ui.registerRenderer("mermaid", (el, code) => {
    let cancelled = false;
    void (async () => {
      try {
        // The app toggles `.dark` on <html>; match mermaid's theme to it.
        const dark = document.documentElement.classList.contains("dark");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: dark ? "dark" : "default",
        });
        const ok = await mermaid.parse(code, { suppressErrors: true });
        if (cancelled) return;
        if (!ok) {
          showSource(el, code);
          return;
        }
        const id = "mermaid-" + Math.random().toString(36).slice(2, 10);
        const { svg } = await mermaid.render(id, code);
        if (cancelled) return;
        const wrap = document.createElement("div");
        wrap.className = "my-2 flex justify-center overflow-x-auto";
        wrap.innerHTML = svg; // mermaid sanitizes (securityLevel: "strict")
        el.replaceChildren(wrap);
      } catch {
        if (!cancelled) showSource(el, code);
      }
    })();
    return () => {
      cancelled = true;
    };
  });
}
