import { useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { prepareImage, type PreparedImage } from "@/lib/image";

interface ComposerProps {
  onSend: (text: string, images: PreparedImage[]) => void;
  disabled?: boolean;
}

export function Composer({ onSend, disabled }: ComposerProps) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<PreparedImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: Iterable<File>) {
    const imageFiles = Array.from(files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (imageFiles.length === 0) return;
    const prepared = await Promise.all(imageFiles.map((f) => prepareImage(f)));
    setImages((prev) => [...prev, ...prepared]);
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  function send() {
    const trimmed = text.trim();
    if (disabled || (!trimmed && images.length === 0)) return;
    onSend(trimmed, images);
    setText("");
    setImages([]);
  }

  return (
    <div
      className="flex flex-col gap-2 border-t p-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void addFiles(e.dataTransfer.files);
      }}
    >
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
          disabled={disabled}
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
        <Button
          onClick={send}
          disabled={
            disabled || (text.trim().length === 0 && images.length === 0)
          }
        >
          Send
        </Button>
      </div>
    </div>
  );
}
