import { type MouseEvent, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { Camera, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ModelChooser } from "@/components/chat/ModelChooser";
import { prepareImage, type PreparedImage } from "@/lib/image";
import {
  hideQuick,
  submitQuick,
  takeScreenshot,
  setQuickHeight,
} from "@/lib/quick";
import {
  QUICK_RECENTS_EVENT,
  cycleDestination,
  destinationThreadId,
  type QuickRecent,
} from "@/lib/quickDestinations";
import { getSetting } from "@/lib/db";
import {
  DEFAULT_PROVIDER_KEY,
  DEFAULT_MODEL_KEY,
  resolveDefault,
} from "@/store/threads";
import { usePlugins } from "@/store/plugins";
import { useModels } from "@/store/models";
import { useKeys } from "@/store/keys";
import { useI18n, useT } from "@/store/i18n";
import { PROVIDERS } from "@/lib/providers";
import type { Provider } from "@/types/db";

/** Overlay window minimum height (matches the Rust clamp floor). */
const QUICK_MIN_HEIGHT = 120;

async function screenshotToImage(base64Png: string): Promise<PreparedImage> {
  const res = await fetch(`data:image/png;base64,${base64Png}`);
  return prepareImage(await res.blob());
}

export function QuickInput() {
  const t = useT();
  const [text, setText] = useState("");
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider>(PROVIDERS[0].id);
  const [model, setModel] = useState<string>(PROVIDERS[0].defaultModel);
  // Destination picker (T31): index 0 = "New chat", 1..n = recent threads.
  const [recents, setRecents] = useState<QuickRecent[]>([]);
  const [destIndex, setDestIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // This window doesn't run App's init, so load the data the model chooser needs
  // (enabled providers + models), and seed the selection from the persisted default.
  useEffect(() => {
    let active = true;
    void usePlugins.getState().load();
    void useModels.getState().load();
    void useKeys.getState().load();
    // Bundled language packs apply synchronously; this folds in user packs.
    void useI18n.getState().loadUserPacks();
    void Promise.all([
      getSetting(DEFAULT_PROVIDER_KEY),
      getSetting(DEFAULT_MODEL_KEY),
    ]).then(([dp, dm]) => {
      if (!active) return;
      const def = resolveDefault(dp, dm);
      setProvider(def.provider);
      setModel(def.model);
    });
    return () => {
      active = false;
    };
  }, []);

  // Recent destination threads (T31). Rust `show_quick` asks the main window,
  // which answers by emitting this event to the overlay — so the list refreshes
  // on every show and this window stays DB-free. Each show is a fresh
  // interaction, so the selection resets to "New chat" (which also clamps a
  // selection that pointed at a since-deleted thread).
  useEffect(() => {
    const unlisten = listen<QuickRecent[]>(QUICK_RECENTS_EVENT, (e) => {
      setRecents(e.payload);
      setDestIndex(0);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // Focus the field whenever the overlay gains focus (i.e. each time it's shown).
  useEffect(() => {
    textareaRef.current?.focus();
    const unlisten = getCurrentWindow().onFocusChanged(({ payload }) => {
      if (payload) textareaRef.current?.focus();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // Grow the overlay window to fit the panel (Rust clamps to [min, max]). Fires
  // on mount and on every content change (textarea growth, previews, error).
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // +16 accounts for the p-2 margin around the panel (8px top + bottom).
      void setQuickHeight(el.offsetHeight + 16);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  async function addFiles(files: Iterable<File>) {
    const imageFiles = Array.from(files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (imageFiles.length === 0) return;
    const prepared = await Promise.all(imageFiles.map((f) => prepareImage(f)));
    setImages((prev) => [...prev, ...prepared]);
  }

  async function screenshot() {
    setBusy(true);
    setError(null);
    try {
      const base64 = await takeScreenshot();
      if (base64) {
        const img = await screenshotToImage(base64);
        setImages((prev) => [...prev, img]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      textareaRef.current?.focus();
    }
  }

  function reset() {
    setText("");
    setImages([]);
    setError(null);
    setDestIndex(0);
    void setQuickHeight(QUICK_MIN_HEIGHT);
  }

  async function submit() {
    const trimmed = text.trim();
    if (busy || (!trimmed && images.length === 0)) return;
    await submitQuick({
      text: trimmed,
      images,
      provider,
      model,
      thread_id: destinationThreadId(recents, destIndex),
    });
    reset();
  }

  async function cancel() {
    reset();
    await hideQuick();
  }

  // Drag the frameless overlay by pressing its empty background — the panel's
  // own padding/gaps or the toolbar spacer (target === currentTarget), never
  // the textarea, buttons, or image previews (which are nested children).
  function startDrag(e: MouseEvent<HTMLDivElement>) {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    void getCurrentWindow().startDragging();
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen items-start justify-center p-2">
        <div
          ref={panelRef}
          onMouseDown={startDrag}
          className="bg-popover text-popover-foreground flex w-full cursor-grab flex-col gap-2 rounded-xl border p-3 shadow-2xl active:cursor-grabbing"
        >
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {images.map((img, i) => (
                <div key={i} className="relative">
                  <img
                    src={img.dataUrl}
                    alt={t("composer.attachmentPreview")}
                    className="size-14 rounded-md object-cover"
                  />
                  <button
                    type="button"
                    aria-label={t("composer.removeImage")}
                    onClick={() =>
                      setImages((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="bg-background/80 absolute -top-1.5 -right-1.5 rounded-full border p-0.5"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-destructive px-1 text-xs">{error}</p>}

          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.some((f) => f.type.startsWith("image/"))) {
                e.preventDefault();
                void addFiles(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                void cancel();
              } else if (
                e.key === "Tab" ||
                (e.ctrlKey && (e.key === "ArrowUp" || e.key === "ArrowDown"))
              ) {
                // Cycle the destination without leaving the textarea (T31):
                // Tab forward, Shift+Tab / Ctrl+Up backward, Ctrl+Down forward.
                e.preventDefault();
                const dir = e.shiftKey || e.key === "ArrowUp" ? -1 : 1;
                setDestIndex((i) => cycleDestination(i, recents.length, dir));
              }
            }}
            placeholder={t("quick.placeholder")}
            className="max-h-[320px] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
            autoFocus
          />

          {/* Destination chips (T31): New chat + up to 5 recent threads. */}
          <div
            className="flex flex-wrap items-center gap-1.5"
            onMouseDown={startDrag}
            role="radiogroup"
            aria-label={t("quick.destination")}
          >
            <DestinationChip
              label={t("quick.newChat")}
              selected={destIndex === 0}
              onSelect={() => {
                setDestIndex(0);
                textareaRef.current?.focus();
              }}
            />
            {recents.map((r, i) => (
              <DestinationChip
                key={r.id}
                label={r.title}
                selected={destIndex === i + 1}
                onSelect={() => {
                  setDestIndex(i + 1);
                  textareaRef.current?.focus();
                }}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <ImagePicker onFiles={addFiles} disabled={busy} />
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("quick.takeScreenshot")}
              disabled={busy}
              onClick={() => void screenshot()}
            >
              <Camera className="size-4" />
            </Button>
            <div
              className="flex-1 cursor-grab self-stretch active:cursor-grabbing"
              onMouseDown={startDrag}
            />
            {/* An existing thread keeps its saved provider/model, so the chooser
              only applies (and shows) when the destination is a new chat. */}
            {destIndex === 0 && (
              <ModelChooser
                provider={provider}
                model={model}
                onSelect={(p, m) => {
                  setProvider(p);
                  setModel(m);
                }}
              />
            )}
            <Button
              onClick={() => void submit()}
              disabled={
                busy || (text.trim().length === 0 && images.length === 0)
              }
            >
              {destIndex === 0 ? t("quick.startChat") : t("common.send")}
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

/**
 * One destination chip (T31). Not focusable (tabIndex -1): keyboard selection
 * happens from the textarea (Tab / Ctrl+Arrows), so Tab never steals the
 * user's typing flow; the mouse remains a shortcut.
 */
function DestinationChip({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={-1}
      onClick={onSelect}
      title={label}
      className={`max-w-40 truncate rounded-full border px-2 py-0.5 text-xs transition-colors ${
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground bg-transparent"
      }`}
    >
      {label}
    </button>
  );
}

function ImagePicker({
  onFiles,
  disabled,
}: {
  onFiles: (files: Iterable<File>) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("composer.attachImage")}
        disabled={disabled}
        onClick={() => ref.current?.click()}
      >
        <Paperclip className="size-4" />
      </Button>
    </>
  );
}
