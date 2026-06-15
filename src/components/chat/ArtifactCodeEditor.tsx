import { lazy, Suspense, useEffect, useState } from "react";
import type { Extension } from "@codemirror/state";
import { guessMediaType } from "@/lib/artifacts";
import { resolveTheme } from "@/lib/theme";
import { useTheme } from "@/store/theme";
import { useT } from "@/store/i18n";

// CodeMirror is a sizeable dependency; load it (and the per-language grammar)
// lazily so it stays out of the main bundle until the user opens the code tab —
// the same code-splitting approach Mermaid/Vega use.
const CodeMirror = lazy(() => import("@uiw/react-codemirror"));

async function languageExtension(path: string): Promise<Extension | null> {
  switch (guessMediaType(path)) {
    case "text/html":
      return (await import("@codemirror/lang-html")).html();
    case "text/css":
      return (await import("@codemirror/lang-css")).css();
    case "text/javascript":
      return (await import("@codemirror/lang-javascript")).javascript({
        jsx: true,
      });
    case "application/json":
      return (await import("@codemirror/lang-javascript")).javascript();
    default:
      return null;
  }
}

/** Editable CodeMirror pane for one artifact file. */
export function ArtifactCodeEditor({
  path,
  value,
  onChange,
}: {
  path: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const dark = resolveTheme(useTheme((s) => s.theme)) === "dark";
  const [extensions, setExtensions] = useState<Extension[]>([]);

  useEffect(() => {
    let alive = true;
    void languageExtension(path).then((ext) => {
      if (alive) setExtensions(ext ? [ext] : []);
    });
    return () => {
      alive = false;
    };
  }, [path]);

  return (
    <Suspense
      fallback={
        <div className="text-muted-foreground p-3 text-xs">
          {t("artifact.loadingEditor")}
        </div>
      }
    >
      <CodeMirror
        value={value}
        theme={dark ? "dark" : "light"}
        extensions={extensions}
        onChange={onChange}
        height="100%"
        style={{ height: "100%", fontSize: "13px" }}
      />
    </Suspense>
  );
}
