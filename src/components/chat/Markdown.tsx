import {
  Children,
  createContext,
  isValidElement,
  memo,
  useContext,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
// github (light) + github-dark scoped to `.dark` — see highlight-theme.css.
import "@/components/chat/highlight-theme.css";
import { CodeBlock } from "@/components/chat/CodeBlock";
import { YouTubeEmbed } from "@/components/chat/YouTubeEmbed";
import { openExternal } from "@/lib/openExternal";
import { hasRenderer } from "@/lib/plugins";
import { parseYouTubeUrl } from "@/lib/youtube";
import { selectRegistry, usePlugins } from "@/store/plugins";

/**
 * Video ids already shown by the message renderer in its labeled video gallery
 * (from the search-result thumbnails). An in-text link to one of these is left
 * as a plain link — the gallery above is the player, so we don't duplicate it.
 * Empty by default → an in-text link renders its own lone player.
 */
const SuppressedVideosContext = createContext<Set<string>>(new Set());

/**
 * A paragraph whose sole content is a single YouTube link → the inline player
 * (com.snak.youtube). Returns null when it isn't such a paragraph or the plugin
 * is disabled, so the caller renders a normal `<p>`. Detecting at the paragraph
 * level keeps the player block-level (valid HTML — an iframe can't live inside a
 * `<p>`/`<a>`); inline-in-prose links stay plain links.
 */
function YouTubeParagraph({ children }: { children?: ReactNode }) {
  const registry = usePlugins(selectRegistry);
  const enabled = hasRenderer(registry, "youtube");
  const suppressed = useContext(SuppressedVideosContext);

  if (enabled) {
    const kids = Children.toArray(children).filter(
      (c) => !(typeof c === "string" && c.trim() === ""),
    );
    if (kids.length === 1 && isValidElement(kids[0])) {
      const props = kids[0].props as { href?: string; children?: ReactNode };
      if (typeof props.href === "string") {
        const ref = parseYouTubeUrl(props.href);
        // Skip videos already in the message's gallery above; otherwise this is
        // a lone link with no search-result thumbnail → its own single player.
        if (ref && !suppressed.has(ref.id)) {
          return (
            <YouTubeEmbed
              options={[{ id: ref.id, href: props.href }]}
              initialId={ref.id}
            />
          );
        }
      }
    }
  }
  return <p className="my-1 leading-relaxed">{children}</p>;
}

/**
 * Renders assistant Markdown richly: GFM (tables, strikethrough, task lists,
 * autolinks), headings, lists, links, inline code, and syntax-highlighted
 * fenced code blocks with a copy button.
 *
 * Safety: raw HTML is NOT enabled (no `rehype-raw`), so embedded HTML in model
 * output is rendered as inert text rather than injected into the DOM.
 *
 * Streaming: react-markdown re-parses the (growing) string on every render and
 * tolerates incomplete Markdown — an unclosed code fence mid-stream renders as
 * a code block that simply keeps growing, so partial output never crashes.
 *
 * Theming: elements use the app's CSS-variable utility classes (`text-*`,
 * `border-*`, `bg-*`) so light/dark follow `index.css`. Syntax colors come from
 * `highlight-theme.css` (github light + github-dark scoped to `.dark`).
 */

const components: Components = {
  // Fenced code blocks arrive wrapped in <pre>; render our CodeBlock (which
  // owns the <pre>/<code>). Pull the language className off the inner <code>.
  pre({ children }) {
    // children is the <code> element; forward its className/children.
    if (
      children &&
      typeof children === "object" &&
      "props" in children &&
      children.props &&
      typeof children.props === "object"
    ) {
      const props = children.props as {
        className?: string;
        children?: React.ReactNode;
      };
      return (
        <CodeBlock className={props.className}>{props.children}</CodeBlock>
      );
    }
    return <pre>{children}</pre>;
  },
  // Inline code only (block code is handled via `pre` above).
  code({ children, className }) {
    return (
      <code
        className={`bg-muted rounded px-1 py-0.5 font-mono text-[0.85em] ${className ?? ""}`}
      >
        {children}
      </code>
    );
  },
  a({ children, href }) {
    return (
      <a
        href={href}
        onClick={(e) => {
          if (!href) return;
          // Route through the OS opener; a plain target="_blank" is unreliable
          // inside the Tauri webview.
          e.preventDefault();
          void openExternal(href);
        }}
        rel="noopener noreferrer"
        className="text-primary cursor-pointer underline underline-offset-2"
      >
        {children}
      </a>
    );
  },
  // Image markdown (`![alt](url)`) is rendered as a LINK, never an inline
  // <img>. Images the model surfaces come through the downloaded-and-verified
  // attachment pipeline (search_images / fetch_images → data: URLs); a remote
  // URL the model writes into its prose is frequently dead or hotlink-blocked
  // and would otherwise show as a broken image. Linking preserves the reference
  // without ever fetching a remote resource.
  img({ src, alt, title }) {
    if (typeof src !== "string" || src.length === 0) return null;
    const label = (alt?.trim() || title?.trim() || src).toString();
    return (
      <a
        href={src}
        onClick={(e) => {
          e.preventDefault();
          void openExternal(src);
        }}
        rel="noopener noreferrer"
        className="text-primary cursor-pointer underline underline-offset-2"
      >
        {label}
      </a>
    );
  },
  h1: ({ children }) => (
    <h1 className="mt-3 mb-2 text-lg font-semibold">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-3 mb-2 text-base font-semibold">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-2 mb-1 text-sm font-semibold">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-2 mb-1 text-sm font-semibold">{children}</h4>
  ),
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  p: ({ children }) => <YouTubeParagraph>{children}</YouTubeParagraph>,
  blockquote: ({ children }) => (
    <blockquote className="border-border text-muted-foreground my-2 border-l-2 pl-3 italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border my-3" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="border-border w-full border-collapse border text-xs">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
  th: ({ children }) => (
    <th className="border-border border px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-border border px-2 py-1 align-top">{children}</td>
  ),
};

function MarkdownImpl({
  content,
  suppressedVideoIds,
}: {
  content: string;
  /** Video ids handled by the gallery above (see SuppressedVideosContext). */
  suppressedVideoIds?: Set<string>;
}) {
  return (
    <div className="text-sm break-words">
      <SuppressedVideosContext.Provider value={suppressedVideoIds ?? EMPTY_SET}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[
            [rehypeHighlight, { detect: true, ignoreMissing: true }],
          ]}
          components={components}
        >
          {content}
        </ReactMarkdown>
      </SuppressedVideosContext.Provider>
    </div>
  );
}

/** Stable empty-set identity so a suppression-less Markdown keeps memo stable. */
const EMPTY_SET = new Set<string>();

// Memoize so unrelated store updates don't re-parse Markdown; during streaming
// `content` changes each token, which still re-renders as intended.
export const Markdown = memo(MarkdownImpl);
