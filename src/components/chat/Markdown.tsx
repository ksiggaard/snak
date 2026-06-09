import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
// github (light) + github-dark scoped to `.dark` — see highlight-theme.css.
import "@/components/chat/highlight-theme.css";
import { CodeBlock } from "@/components/chat/CodeBlock";

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
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2"
      >
        {children}
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
  p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
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

function MarkdownImpl({ content }: { content: string }) {
  return (
    <div className="text-sm break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [rehypeHighlight, { detect: true, ignoreMissing: true }],
        ]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// Memoize so unrelated store updates don't re-parse Markdown; during streaming
// `content` changes each token, which still re-renders as intended.
export const Markdown = memo(MarkdownImpl);
