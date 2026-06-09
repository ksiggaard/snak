import { useState } from "react";
import { Check, Copy, SquareTerminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { codeText, languageFromClassName } from "@/lib/markdown";
import { isShellLanguage, openInTerminal } from "@/lib/terminal";

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
  const language = languageFromClassName(className);
  const text = codeText(children);
  const [copied, setCopied] = useState(false);
  const isShell = isShellLanguage(language);

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
              aria-label="Open in terminal"
              title="Open in terminal (staged, not run — review and press Enter)"
              className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
            >
              <SquareTerminal className="size-3" /> Open in terminal
            </button>
          )}
          <button
            type="button"
            onClick={onCopy}
            aria-label="Copy code"
            className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
          >
            {copied ? (
              <>
                <Check className="size-3" /> Copied
              </>
            ) : (
              <>
                <Copy className="size-3" /> Copy
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
