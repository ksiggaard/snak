import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Camera, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { prepareImage, type PreparedImage } from "@/lib/image";
import { hideQuick, submitQuick, takeScreenshot } from "@/lib/quick";

async function screenshotToImage(base64Png: string): Promise<PreparedImage> {
  const res = await fetch(`data:image/png;base64,${base64Png}`);
  return prepareImage(await res.blob());
}

export function QuickInput() {
  const [text, setText] = useState("");
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    try {
      const base64 = await takeScreenshot();
      if (base64) {
        const img = await screenshotToImage(base64);
        setImages((prev) => [...prev, img]);
      }
    } finally {
      setBusy(false);
      textareaRef.current?.focus();
    }
  }

  function reset() {
    setText("");
    setImages([]);
  }

  async function submit() {
    const trimmed = text.trim();
    if (busy || (!trimmed && images.length === 0)) return;
    await submitQuick({ text: trimmed, images });
    reset();
  }

  async function cancel() {
    reset();
    await hideQuick();
  }

  return (
    <div className="flex h-screen items-start justify-center p-2">
      <div className="bg-popover text-popover-foreground flex w-full flex-col gap-2 rounded-xl border p-3 shadow-2xl">
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
          rows={3}
          className="resize-none border-0 shadow-none focus-visible:ring-0"
          autoFocus
        />

        <div className="flex items-center gap-2">
          <ImagePicker onFiles={addFiles} disabled={busy} />
          <Button
            variant="outline"
            size="icon"
            aria-label="Take screenshot"
            disabled={busy}
            onClick={() => void screenshot()}
          >
            <Camera className="size-4" />
          </Button>
          <div className="flex-1" />
          <Button
            onClick={() => void submit()}
            disabled={busy || (text.trim().length === 0 && images.length === 0)}
          >
            Start chat
          </Button>
        </div>
      </div>
    </div>
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
        variant="outline"
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
