import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, RotateCw } from "lucide-react";
import { ARTIFACT_BRIDGE_SOURCE, assembleArtifact } from "@/lib/artifacts";
import { cn } from "@/lib/utils";
import { useT } from "@/store/i18n";
import type { ArtifactFile } from "@/types/db";

// A schemeless input that looks like a host (has a dotted TLD, no spaces) is
// treated as an external URL and given https://; "#route" / "/path" pass through.
const BARE_HOST = /^[^\s/#]+\.[a-z]{2,}(?:[/?#]|$)/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Renders an artifact's files as a live preview inside a **sandboxed** iframe.
 *
 * Security: the iframe gets `allow-scripts` (so the app runs) but deliberately
 * NOT `allow-same-origin` — it stays an opaque origin and cannot reach the
 * Tauri IPC bridge or the app's own origin/storage. This is why
 * `assembleArtifact` inlines local CSS/JS and uses `data:` URLs for ES modules
 * rather than blob/relative URLs. Cross-origin network fetches (CDNs) still work.
 *
 * Address bar: opt-in (`showAddressBar`). Because we can't read the iframe's
 * location across the opaque-origin boundary, a small bridge script (injected
 * via `navBridge`) reports the location and accepts navigation commands over
 * postMessage — keeping the sandbox locked down.
 */
export function ArtifactFrame({
  files,
  title,
  className,
  interactive = true,
  showAddressBar = false,
}: {
  files: ArtifactFile[];
  title?: string;
  className?: string;
  /** When false the preview is display-only (no pointer events) — used for the
   * inline card thumbnail so it doesn't capture scroll/clicks. */
  interactive?: boolean;
  /** Show a navigable address bar above the preview (for URL/hash-routed
   * artifacts). Injects the navigation bridge into the preview document. */
  showAddressBar?: boolean;
}) {
  const t = useT();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [address, setAddress] = useState("");
  const srcDoc = useMemo(
    () => assembleArtifact(files, { navBridge: showAddressBar }),
    [files, showAddressBar],
  );

  // Track the preview's location via the bridge (only relevant with the bar).
  useEffect(() => {
    if (!showAddressBar) return;
    function onMessage(e: MessageEvent) {
      if (e.source !== frameRef.current?.contentWindow) return;
      const d = e.data as { source?: string; href?: string };
      if (
        d &&
        d.source === ARTIFACT_BRIDGE_SOURCE &&
        typeof d.href === "string"
      )
        setAddress(d.href);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [showAddressBar]);

  const post = (cmd: string, href?: string) =>
    frameRef.current?.contentWindow?.postMessage(
      { target: ARTIFACT_BRIDGE_SOURCE, cmd, href },
      "*",
    );

  const navigate = () => {
    let url = address.trim();
    if (!url) return;
    if (!HAS_SCHEME.test(url) && BARE_HOST.test(url)) url = `https://${url}`;
    post("nav", url);
  };

  const iframe = (
    <iframe
      ref={frameRef}
      title={title ?? t("artifact.previewTitle")}
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals allow-forms"
      className={cn(
        "h-full w-full border-0 bg-white",
        !interactive && "pointer-events-none",
        className,
      )}
    />
  );

  if (!showAddressBar) return iframe;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="bg-muted/30 flex items-center gap-1 border-b px-2 py-1">
        <button
          type="button"
          aria-label={t("artifact.back")}
          title={t("artifact.back")}
          onClick={() => post("back")}
          className="text-muted-foreground hover:text-foreground rounded p-1"
        >
          <ArrowLeft className="size-4" />
        </button>
        <button
          type="button"
          aria-label={t("artifact.forward")}
          title={t("artifact.forward")}
          onClick={() => post("forward")}
          className="text-muted-foreground hover:text-foreground rounded p-1"
        >
          <ArrowRight className="size-4" />
        </button>
        <button
          type="button"
          aria-label={t("artifact.refresh")}
          title={t("artifact.refresh")}
          onClick={() => post("reload")}
          className="text-muted-foreground hover:text-foreground rounded p-1"
        >
          <RotateCw className="size-4" />
        </button>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              navigate();
            }
          }}
          placeholder={t("artifact.address")}
          className="bg-background min-w-0 flex-1 rounded-md border px-2 py-1 font-mono text-xs outline-none"
        />
      </div>
      <div className="min-h-0 flex-1">{iframe}</div>
    </div>
  );
}
