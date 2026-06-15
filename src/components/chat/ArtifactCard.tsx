import {
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Code2,
  FileCode,
  GripHorizontal,
  Loader2,
  Pause,
  Play,
  SquareArrowOutUpRight,
} from "lucide-react";
import { parseArtifact } from "@/lib/artifacts";
import { ArtifactContext } from "@/components/chat/artifactContext";
import { ArtifactFrame } from "@/components/chat/ArtifactFrame";
import { ArtifactViewer } from "@/components/chat/ArtifactViewer";
import { useArtifacts } from "@/store/artifacts";
import { useT, useTp } from "@/store/i18n";

// The inline preview height is a user preference shared by all cards, persisted
// in localStorage and read synchronously at mount (no flash, no effect).
const PREVIEW_HEIGHT_KEY = "artifact.previewHeight";
const MIN_PREVIEW_HEIGHT = 120;
const MAX_PREVIEW_HEIGHT = 2000;
const DEFAULT_PREVIEW_HEIGHT = 224;

// Shared styling for the card's header action buttons (pause/run · code · open).
const HEADER_ACTION_CLASS =
  "text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors";

function initialPreviewHeight(): number {
  try {
    const v = Number(localStorage.getItem(PREVIEW_HEIGHT_KEY));
    if (Number.isFinite(v) && v >= MIN_PREVIEW_HEIGHT)
      return Math.min(v, MAX_PREVIEW_HEIGHT);
  } catch {
    // localStorage unavailable → fall back to the default.
  }
  return DEFAULT_PREVIEW_HEIGHT;
}

/**
 * Inline rendering of a ` ```artifact ` block: a card with the title, a
 * (non-interactive) live thumbnail, and Open/Code buttons that launch the
 * fullscreen `ArtifactViewer`. Enabled via the `com.snak.artifacts` renderer
 * plugin; when disabled, `CodeBlock` shows the raw source instead.
 *
 * Streaming-safe: until the block parses (at least one `--- path ---` file), it
 * shows a "Building…" placeholder. Once the owning message is persisted, the
 * card upserts an `artifacts` row (via the store) so the artifact — and any
 * edits made in the viewer — survive reloads.
 */
export function ArtifactCard({ code }: { code: string }) {
  const t = useT();
  const tp = useTp();
  const ctx = useContext(ArtifactContext);
  const slotKey = useId();
  const ensure = useArtifacts((s) => s.ensure);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const stored = useArtifacts((s) =>
    artifactId ? s.byId[artifactId] : undefined,
  );
  const [view, setView] = useState<"preview" | "code" | null>(null);
  // The inline thumbnail runs the artifact's scripts live; pausing unmounts the
  // iframe so a performance-intensive artifact (animation/game loop) stops
  // consuming CPU in the chat. The fullscreen viewer still runs on demand.
  const [running, setRunning] = useState(true);
  const [height, setHeight] = useState(initialPreviewHeight);

  // Drag the bottom handle to resize the preview; persist the final height as
  // the shared default. Window listeners (not an effect) avoid losing the drag
  // when the pointer crosses the iframe.
  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    let latest = startH;
    const onMove = (ev: PointerEvent) => {
      latest = Math.max(
        MIN_PREVIEW_HEIGHT,
        Math.min(MAX_PREVIEW_HEIGHT, startH + ev.clientY - startY),
      );
      setHeight(latest);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      try {
        localStorage.setItem(PREVIEW_HEIGHT_KEY, String(latest));
      } catch {
        // Persisting is best-effort; the height still applies this session.
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const parsed = useMemo(() => parseArtifact(code), [code]);

  useEffect(() => {
    if (!parsed || !ctx.messageId || !ctx.threadId) return;
    let alive = true;
    void ensure({
      thread_id: ctx.threadId,
      message_id: ctx.messageId,
      ordinal: ctx.ordinalFor(slotKey),
      title: parsed.title,
      files: parsed.files,
    }).then((a) => {
      if (alive) setArtifactId(a.id);
    });
    return () => {
      alive = false;
    };
  }, [parsed, ctx, ensure, slotKey]);

  if (!parsed) {
    return (
      <div className="border-border bg-background/60 text-muted-foreground my-2 flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
        <Loader2 className="size-3 animate-spin" />
        {t("artifact.building")}
      </div>
    );
  }

  const files = stored?.files ?? parsed.files;
  const title = stored?.title ?? parsed.title;

  return (
    <div className="border-border bg-background/60 my-2 overflow-hidden rounded-md border">
      <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <FileCode className="text-muted-foreground size-3.5 shrink-0" />
          <span className="truncate font-medium">{title}</span>
          <span className="text-muted-foreground shrink-0">
            {tp("artifact.fileCount", files.length)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setRunning((r) => !r)}
            className={HEADER_ACTION_CLASS}
          >
            {running ? (
              <>
                <Pause className="size-3" /> {t("artifact.pause")}
              </>
            ) : (
              <>
                <Play className="size-3" /> {t("artifact.run")}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setView("code")}
            className={HEADER_ACTION_CLASS}
          >
            <Code2 className="size-3" /> {t("artifact.code")}
          </button>
          <button
            type="button"
            onClick={() => setView("preview")}
            className={HEADER_ACTION_CLASS}
          >
            <SquareArrowOutUpRight className="size-3" /> {t("artifact.open")}
          </button>
        </div>
      </div>
      {running ? (
        // Non-interactive live thumbnail; click opens the fullscreen viewer.
        <button
          type="button"
          onClick={() => setView("preview")}
          aria-label={t("artifact.open")}
          style={{ height }}
          className="focus-visible:ring-ring relative block w-full cursor-zoom-in overflow-hidden focus-visible:ring-2 focus-visible:outline-none"
        >
          <ArtifactFrame files={files} title={title} interactive={false} />
          <span className="absolute inset-0" />
        </button>
      ) : (
        // Paused: the iframe is unmounted, so no scripts run. Click to resume.
        <button
          type="button"
          onClick={() => setRunning(true)}
          style={{ height }}
          className="bg-muted/30 text-muted-foreground hover:text-foreground focus-visible:ring-ring flex w-full flex-col items-center justify-center gap-2 text-xs focus-visible:ring-2 focus-visible:outline-none"
        >
          <Play className="size-6" />
          <span>{t("artifact.paused")}</span>
          <span className="text-[11px]">{t("artifact.run")}</span>
        </button>
      )}
      {/* Drag to resize the preview height (persisted as the shared default). */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("artifact.resize")}
        title={t("artifact.resize")}
        onPointerDown={startResize}
        className="border-border text-muted-foreground hover:bg-accent flex h-3 w-full cursor-row-resize touch-none items-center justify-center border-t transition-colors"
      >
        <GripHorizontal className="size-3" />
      </div>

      {view && (
        <ArtifactViewer
          artifactId={artifactId}
          title={title}
          files={files}
          initialTab={view}
          onClose={() => setView(null)}
        />
      )}
    </div>
  );
}
