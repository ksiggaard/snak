import { useEffect, useRef, useState } from "react";
import { Paperclip, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { prepareImage, type PreparedImage } from "@/lib/image";
import { hasApiKey } from "@/lib/keys";
import { PROVIDERS } from "@/lib/providers";
import type { Provider } from "@/types/db";

interface ComposerProps {
  onSend: (text: string, images: PreparedImage[]) => void;
  /** Cancel the in-flight stream (shown as a Stop button while busy). */
  onCancel: () => void;
  /** Streaming is in progress: show Stop instead of Send. */
  busy?: boolean;
  /** Currently selected provider — Send is gated on it having a stored key. */
  provider: Provider;
}

const providerLabel = (id: Provider) =>
  PROVIDERS.find((p) => p.id === id)?.label ?? id;

export function Composer({ onSend, onCancel, busy, provider }: ComposerProps) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Whether the selected provider has a stored API key. The value is reset to
  // `unknown` synchronously at render when the provider changes (the sanctioned
  // render-time sync pattern), then resolved by an async keychain check; the
  // cleanup flag drops a stale result if the provider switched again first.
  const [keyReady, setKeyReady] = useState<boolean | null>(null);
  const [checkedProvider, setCheckedProvider] = useState<Provider>(provider);
  if (provider !== checkedProvider) {
    setCheckedProvider(provider);
    setKeyReady(null);
  }
  useEffect(() => {
    let active = true;
    void hasApiKey(provider).then((ok) => {
      if (active) setKeyReady(ok);
    });
    return () => {
      active = false;
    };
  }, [provider]);

  async function addFiles(files: Iterable<File>) {
    const imageFiles = Array.from(files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (imageFiles.length === 0) return;
    setAttachError(null);
    try {
      const prepared = await Promise.all(imageFiles.map((f) => prepareImage(f)));
      setImages((prev) => [...prev, ...prepared]);
    } catch {
      setAttachError(
        "Couldn't process that image — it may be too large or an unsupported format.",
      );
    }
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  function send() {
    const trimmed = text.trim();
    if (busy || keyReady === false || (!trimmed && images.length === 0)) return;
    onSend(trimmed, images);
    setText("");
    setImages([]);
    setAttachError(null);
  }

  const noKey = keyReady === false;
  const composeDisabled = busy || noKey;
  const canSend = !composeDisabled && (text.trim().length > 0 || images.length > 0);

  return (
    <div
      className="flex flex-col gap-2 border-t p-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void addFiles(e.dataTransfer.files);
      }}
    >
      {noKey && (
        <p className="text-muted-foreground text-xs">
          No API key set for {providerLabel(provider)}. Add one in Settings to
          send messages.
        </p>
      )}
      {attachError && (
        <p className="text-destructive text-xs">{attachError}</p>
      )}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((img, i) => (
            <div key={i} className="relative">
              <img
                src={img.dataUrl}
                alt="attachment preview"
                className="size-16 rounded-md object-cover"
              />
              <button
                type="button"
                aria-label="Remove image"
                onClick={() => removeImage(i)}
                className="bg-background/80 absolute -top-1.5 -right-1.5 rounded-full border p-0.5"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          variant="outline"
          size="icon"
          aria-label="Attach image"
          disabled={composeDisabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="size-4" />
        </Button>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.some((f) => f.type.startsWith("image/"))) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          placeholder="Type a message…  (Enter to send, Shift+Enter for newline)"
          rows={2}
          className="max-h-40 min-h-0 resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {busy ? (
          <Button
            type="button"
            variant="destructive"
            onClick={onCancel}
            aria-label="Stop generating"
          >
            <Square className="size-4" />
            Stop
          </Button>
        ) : (
          <Button onClick={send} disabled={!canSend}>
            Send
          </Button>
        )}
      </div>
    </div>
  );
}
