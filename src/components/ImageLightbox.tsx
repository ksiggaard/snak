import { useEffect, useMemo, useState } from "react";
import { Check, CornerDownLeft, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadImage, downloadSvg, fitSvg } from "@/lib/images";
import { imageDataUrl } from "@/lib/messages";
import { useLightbox } from "@/store/lightbox";
import { useSearch } from "@/store/search";
import { useT } from "@/store/i18n";

/**
 * The single full-size viewer, mounted once at the app root and driven by the
 * `useLightbox` store (T44). Shows either a stored image or a rendered SVG
 * diagram. Backdrop / Esc / X close it; a Download button saves the content via
 * the native "Save as…" dialog (image → original format, diagram → `.svg`);
 * when the entry carries a `messageId` (panel media gallery) it also offers a
 * jump to that message.
 */
export function ImageLightbox() {
  const t = useT();
  const content = useLightbox((s) => s.content);
  const messageId = useLightbox((s) => s.messageId);
  const close = useLightbox((s) => s.close);
  const requestScroll = useSearch((s) => s.requestScroll);
  // "idle" → "saved" (briefly, mirroring CodeBlock's copy button) → "idle";
  // "error" on a failed write. Cancelling the dialog leaves it "idle".
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  // Reset the button when a different item is opened (render-time adjustment,
  // not an effect — the project forbids setState-in-effect).
  const [statusFor, setStatusFor] = useState(content);
  if (statusFor !== content) {
    setStatusFor(content);
    setStatus("idle");
  }

  // Scaled-to-fit SVG markup (recomputed only when the diagram changes).
  const fittedSvg = useMemo(
    () => (content?.kind === "svg" ? fitSvg(content.svg) : null),
    [content],
  );

  useEffect(() => {
    if (!content) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [content, close]);

  if (!content) return null;

  const onDownload = async () => {
    try {
      const saved =
        content.kind === "image"
          ? await downloadImage(content.image)
          : await downloadSvg(content.svg);
      if (saved) {
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 1500);
      }
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2000);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 backdrop-blur-sm"
      onClick={close}
    >
      {content.kind === "image" ? (
        <img
          src={imageDataUrl(content.image)}
          alt=""
          onClick={(e) => e.stopPropagation()}
          className="max-h-[82vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
        />
      ) : (
        <div
          onClick={(e) => e.stopPropagation()}
          // SVG comes from mermaid's own renderer (securityLevel:"strict"),
          // sanitized before it ever reaches us; `fitSvg` only rewrites the
          // root <svg> sizing attributes.
          dangerouslySetInnerHTML={{ __html: fittedSvg ?? content.svg }}
          className="flex h-[82vh] w-[92vw] items-center justify-center rounded-lg [&>svg]:h-full [&>svg]:w-full"
        />
      )}
      <div
        className="flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <Button variant="secondary" size="sm" onClick={onDownload}>
          {status === "saved" ? (
            <>
              <Check className="size-4" />
              {t("chat.imageSaved")}
            </>
          ) : (
            <>
              <Download className="size-4" />
              {status === "error"
                ? t("chat.imageSaveFailed")
                : t("chat.downloadImage")}
            </>
          )}
        </Button>
        {messageId && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              requestScroll(messageId);
              close();
            }}
          >
            <CornerDownLeft className="size-4" />
            {t("panel.goToMessage")}
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          aria-label={t("panel.close")}
          onClick={close}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
