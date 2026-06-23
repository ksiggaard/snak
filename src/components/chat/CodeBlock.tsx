import { useEffect, useRef, useState } from "react";
import { Check, Copy, SquareTerminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { codeText, languageFromClassName } from "@/lib/markdown";
import { hasRenderer } from "@/lib/plugins";
import { isShellLanguage, openInTerminal } from "@/lib/terminal";
import { ArtifactCard } from "@/components/chat/ArtifactCard";
import { ARTIFACT_LANGUAGE, parseArtifact } from "@/lib/artifacts";
import { selectRegistry, usePlugins } from "@/store/plugins";
import { useContributions, type RendererItem } from "@/store/contributions";
import { useStreaming } from "@/components/chat/streamingContext";
import { useT } from "@/store/i18n";

interface CodeBlockProps {
  className?: string;
  children?: React.ReactNode;
}

/**
 * Renders a fenced code block (the `<pre><code>` pair from react-markdown) with
 * a copy-to-clipboard button and a language badge.
 *
 * The detected fence language is surfaced two ways for downstream consumers:
 * a `data-language` attribute on the wrapper and the original `language-<lang>`
 * class on the inner `<code>`. T17 ("open in terminal" for bash/sh blocks) can
 * match on `data-language` to decide whether to offer its action.
 */
export function CodeBlock({ className, children }: CodeBlockProps) {
  const t = useT();
  const language = languageFromClassName(className);
  const text = codeText(children);
  const [copied, setCopied] = useState(false);
  const isShell = isShellLanguage(language);

  // Renderer plugins (T42): a fenced language with an enabled `renderer`
  // contribution is drawn as a diagram instead of a highlighted code block.
  // Per the T12 declarative model the manifest only *names* the language; the
  // host supplies the component — mermaid is the only built-in renderer, so a
  // manifest claiming any other language has no effect here. Disabling the
  // plugin falls through to the normal code block (shows the raw source).
  const registry = usePlugins(selectRegistry);

  // Runtime-plugin renderers (registered via ctx.ui.registerRenderer) take
  // precedence: an installed plugin can render any fenced language as a custom
  // view. Falls through to the built-in renderers / plain block otherwise.
  const pluginRenderer = useContributions((s) =>
    language ? s.renderers[language.toLowerCase()] : undefined,
  );
  if (language && pluginRenderer) {
    return <PluginRenderedBlock item={pluginRenderer} code={text} />;
  }

  // Artifacts (com.snak.artifacts): a ```artifact block becomes a live, editable
  // multi-file web app card instead of a highlighted block.
  if (
    language &&
    language.toLowerCase() === ARTIFACT_LANGUAGE &&
    hasRenderer(registry, ARTIFACT_LANGUAGE)
  ) {
    return <ArtifactCard code={text} />;
  }
  // Some models emit the artifact as a JSON object in a ```json fence instead of
  // the ```artifact format — render it as an artifact when it's clearly one.
  if (
    language &&
    language.toLowerCase() === "json" &&
    hasRenderer(registry, ARTIFACT_LANGUAGE) &&
    parseArtifact(text)
  ) {
    return <ArtifactCard code={text} />;
  }
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable (e.g. no permission); ignore silently.
    }
  };

  // Stage (never auto-run) the command in an OS terminal for the user to review.
  const onOpenInTerminal = async () => {
    if (!text.trim()) return;
    try {
      await openInTerminal(text);
    } catch {
      // Launch failed (e.g. no terminal emulator); ignore silently.
    }
  };

  return (
    <div
      data-language={language ?? undefined}
      className="border-border bg-background/60 group relative my-2 overflow-hidden rounded-md border"
    >
      <div className="border-border text-muted-foreground flex items-center justify-between border-b px-3 py-1 text-xs">
        <span className="font-mono">{language ?? "text"}</span>
        <div className="flex items-center gap-3">
          {isShell && (
            <button
              type="button"
              onClick={onOpenInTerminal}
              aria-label={t("chat.openInTerminal")}
              title={t("chat.openInTerminalTitle")}
              className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
            >
              <SquareTerminal className="size-3" /> {t("chat.openInTerminal")}
            </button>
          )}
          <button
            type="button"
            onClick={onCopy}
            aria-label={t("chat.copyCode")}
            className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
          >
            {copied ? (
              <>
                <Check className="size-3" /> {t("chat.copied")}
              </>
            ) : (
              <>
                <Copy className="size-3" /> {t("chat.copy")}
              </>
            )}
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code className={cn("font-mono", className)}>{children}</code>
      </pre>
    </div>
  );
}

/** Mounts a runtime-plugin renderer for a fenced block — the plugin's
 * `mount(el, code)` draws into the container; cleanup runs on unmount. */
function PluginRenderedBlock({
  item,
  code,
}: {
  item: RendererItem;
  code: string;
}) {
  // Don't mount mid-stream: the source grows token-by-token, so a renderer would
  // repaint partial/invalid content and flicker. Show the raw "source so far"
  // until the reply completes, then render once. (Generalises the old Mermaid
  // streaming guard to every plugin renderer.)
  const streaming = useStreaming();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (streaming) return;
    const el = ref.current;
    if (!el) return;
    let cleanup: void | (() => void);
    try {
      cleanup = item.mount(el, code);
    } catch (e) {
      console.error(`[plugin ${item.pluginId}] renderer mount threw`, e);
    }
    return () => {
      try {
        if (typeof cleanup === "function") cleanup();
      } catch (e) {
        console.error(`[plugin ${item.pluginId}] renderer cleanup threw`, e);
      }
      el.replaceChildren();
    };
  }, [item, code, streaming]);

  if (streaming) {
    return (
      <pre className="border-border bg-background/60 my-2 overflow-x-auto rounded-md border p-3 font-mono text-xs">
        {code}
      </pre>
    );
  }
  return <div ref={ref} className="my-2" />;
}
