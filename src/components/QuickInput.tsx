import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Camera, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ModelChooser } from "@/components/chat/ModelChooser";
import { prepareImage, type PreparedImage } from "@/lib/image";
import { hideQuick, submitQuick, takeScreenshot, setQuickHeight } from "@/lib/quick";
import { getSetting } from "@/lib/db";
import {
  DEFAULT_PROVIDER_KEY,
  DEFAULT_MODEL_KEY,
  resolveDefault,
} from "@/store/threads";
import { usePlugins } from "@/store/plugins";
import { useModels } from "@/store/models";
import { PROVIDERS } from "@/lib/providers";
import type { Provider } from "@/types/db";

/** Overlay window minimum height (matches the Rust clamp floor). */
const QUICK_MIN_HEIGHT = 160;

async function screenshotToImage(base64Png: string): Promise<PreparedImage> {
  const res = await fetch(`data:image/png;base64,${base64Png}`);
  return prepareImage(await res.blob());
}

export function QuickInput() {
  const [text, setText] = useState("");
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider>(PROVIDERS[0].id);
  const [model, setModel] = useState<string>(PROVIDERS[0].defaultModel);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // This window doesn't run App's init, so load the data the model chooser needs
  // (enabled providers + models), and seed the selection from the persisted default.
  useEffect(() => {
    let active = true;
    void usePlugins.getState().load();
    void useModels.getState().load();
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
    void setQuickHeight(QUICK_MIN_HEIGHT);
  }

  async function submit() {
    const trimmed = text.trim();
    if (busy || (!trimmed && images.length === 0)) return;
    await submitQuick({ text: trimmed, images, provider, model });
    reset();
  }

  async function cancel() {
    reset();
    await hideQuick();
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen items-start justify-center p-2">
      <div
        ref={panelRef}
        className="bg-popover text-popover-foreground flex w-full flex-col gap-2 rounded-xl border p-3 shadow-2xl"
      >
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => (
              <div key={i} className="relative">
                <img
                  src={img.dataUrl}
                  alt="attachment preview"
                  className="size-14 rounded-md object-cover"
                />
                <button
                  type="button"
                  aria-label="Remove image"
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
            }
          }}
          placeholder="Ask anything…  (Enter to start a chat, Esc to dismiss)"
          className="max-h-[320px] resize-none border-0 shadow-none focus-visible:ring-0"
          autoFocus
        />

        <div className="flex items-center gap-2">
          <ImagePicker onFiles={addFiles} disabled={busy} />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Take screenshot"
            disabled={busy}
            onClick={() => void screenshot()}
          >
            <Camera className="size-4" />
          </Button>
          <div className="flex-1" />
          <ModelChooser
            provider={provider}
            model={model}
            onSelect={(p, m) => {
              setProvider(p);
              setModel(m);
            }}
          />
          <Button
            onClick={() => void submit()}
            disabled={busy || (text.trim().length === 0 && images.length === 0)}
          >
            Start chat
          </Button>
        </div>
      </div>
      </div>
    </TooltipProvider>
  );
}

function ImagePicker({
  onFiles,
  disabled,
}: {
  onFiles: (files: Iterable<File>) => void;
  disabled?: boolean;
}) {
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
        aria-label="Attach image"
        disabled={disabled}
        onClick={() => ref.current?.click()}
      >
        <Paperclip className="size-4" />
      </Button>
    </>
  );
}
