import { useEffect, useState } from "react";
import { PictureInPicture2, Play, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { mediaPlaybackAvailable } from "@/lib/media";
import { openExternal } from "@/lib/openExternal";
import { popOutVideo } from "@/lib/videoWindow";
import {
  parseYouTubeUrl,
  youTubeEmbedSrc,
  type YouTubeVideoOption,
} from "@/lib/youtube";
import { useT } from "@/store/i18n";

/**
 * Inline YouTube player for detected video link(s) (enabled via the built-in
 * `renderer` plugin `com.snak.youtube`; when disabled the link renders plainly).
 *
 * Takes the set of videos that match the query — the one the message linked plus
 * the other tool-result options — and plays the **active** one. When there's
 * more than one, a thumbnail strip below the player lets the user toggle which
 * video is active (so the other search thumbnails are interactive options, not
 * confusing static images). With a single video it's just the player.
 *
 * Privacy: a **click-to-play facade** — nothing contacts YouTube until the user
 * clicks Play. The poster/strip thumbnails reuse the already-downloaded
 * tool-result images, so showing them adds no network request.
 *
 * Codecs: if inline playback would crash the webview (missing GStreamer sink),
 * Play / pop-out open the active video in the system browser instead.
 */
export function YouTubeEmbed({
  options,
  initialId,
}: {
  options: YouTubeVideoOption[];
  initialId: string;
}) {
  const t = useT();
  const [activeId, setActiveId] = useState(initialId);
  const [playing, setPlaying] = useState(false);
  // null = probing; false = inline playback would crash the webview (missing
  // codecs) → fall back to the system browser instead of mounting the iframe.
  const [canEmbed, setCanEmbed] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void mediaPlaybackAvailable().then((ok) => {
      if (alive) setCanEmbed(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  const active = options.find((o) => o.id === activeId) ?? options[0];
  const label = active.title || active.href;
  // Recover a start offset from the active link, falling back to the bare id.
  const videoRef = parseYouTubeUrl(active.href) ?? { id: active.id };

  const onPlay = async () => {
    const ok = canEmbed ?? (await mediaPlaybackAvailable());
    if (ok) setPlaying(true);
    else void openExternal(active.href);
  };

  const onPopOut = async () => {
    const ok = canEmbed ?? (await mediaPlaybackAvailable());
    if (ok) void popOutVideo(videoRef, label);
    else void openExternal(active.href);
  };

  // Switching the active video returns to the facade so the user presses Play
  // (and the new poster shows immediately).
  const selectOption = (id: string) => {
    setActiveId(id);
    setPlaying(false);
  };

  return (
    <div className="border-border bg-background/60 my-2 overflow-hidden rounded-md border">
      {playing ? (
        <iframe
          src={youTubeEmbedSrc(videoRef)}
          title={label}
          className="aspect-video w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      ) : (
        <button
          type="button"
          onClick={() => void onPlay()}
          aria-label={t("chat.playVideo")}
          title={
            canEmbed === false ? t("chat.openOnYouTube") : t("chat.playVideo")
          }
          className="bg-muted group focus-visible:ring-ring relative flex aspect-video w-full cursor-pointer items-center justify-center focus-visible:ring-2 focus-visible:outline-none"
        >
          {active.poster && (
            <img
              src={active.poster}
              alt={label}
              className="absolute inset-0 size-full object-cover"
            />
          )}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-red-600 text-white shadow-md transition-transform group-hover:scale-110">
              <Play className="size-7 translate-x-0.5 fill-current" />
            </span>
          </span>
        </button>
      )}

      {options.length > 1 && (
        <div className="flex gap-2 overflow-x-auto px-3 pt-2">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => selectOption(o.id)}
              aria-label={o.title || o.href}
              title={o.title || o.href}
              className={cn(
                "focus-visible:ring-ring relative aspect-video w-24 shrink-0 cursor-pointer overflow-hidden rounded transition-opacity focus-visible:ring-2 focus-visible:outline-none",
                o.id === activeId
                  ? "ring-primary ring-2"
                  : "opacity-70 hover:opacity-100",
              )}
            >
              {o.poster ? (
                <img
                  src={o.poster}
                  alt=""
                  className="size-full object-cover"
                  aria-hidden
                />
              ) : (
                <span className="bg-muted text-muted-foreground flex size-full items-center justify-center">
                  <Play className="size-4 fill-current" />
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="text-muted-foreground flex items-center gap-2 px-3 py-1.5 text-xs">
        <a
          href={active.href}
          onClick={(e) => {
            e.preventDefault();
            void openExternal(active.href);
          }}
          rel="noopener noreferrer"
          title={t("chat.openOnYouTube")}
          className="hover:text-foreground flex min-w-0 flex-1 items-center gap-1.5 transition-colors"
        >
          <Video className="size-3.5 shrink-0" />
          <span className="truncate underline underline-offset-2">{label}</span>
        </a>
        {canEmbed !== false && (
          <button
            type="button"
            onClick={() => void onPopOut()}
            aria-label={t("chat.popOutVideo")}
            title={t("chat.popOutVideo")}
            className="hover:text-foreground inline-flex shrink-0 cursor-pointer items-center gap-1 transition-colors"
          >
            <PictureInPicture2 className="size-3.5" />
            {t("chat.popOut")}
          </button>
        )}
      </div>
      {canEmbed === false && (
        <p className="text-muted-foreground border-border border-t px-3 py-1.5 text-xs">
          {t("chat.inlineVideoUnavailable")}
        </p>
      )}
    </div>
  );
}
