import { useRef, useState } from "react";
import { X, Image as ImageIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { prepareImage, type PreparedImage } from "@/lib/image";
import { useT } from "@/store/i18n";

interface ImageChipProps {
  image: PreparedImage;
  index: number;
  onRemove: (index: number) => void;
  onReplace: (index: number, image: PreparedImage) => void;
  size?: string;
}

export function ImageChip({
  image,
  index,
  onRemove,
  onReplace,
  size = "size-16",
}: ImageChipProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleReplace(file: File) {
    try {
      const prepared = await prepareImage(file);
      onReplace(index, prepared);
    } catch {
      // Silently ignore — same behavior as existing Composer drop zone.
    }
  }

  /** Extract an image File from a DataTransfer, trying .files first, then
   *  .items (needed on Linux where browser/clipboard drags use items). */
  function fileFromTransfer(dt: DataTransfer): File | undefined {
    if (dt.files.length > 0) return dt.files[0];
    for (const item of dt.items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const blob = item.getAsFile();
        if (blob) return new File([blob], blob.name || "image.png", { type: blob.type });
      }
    }
    return undefined;
  }

  return (
    <div
      className="relative shrink-0"
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.files.length > 0 || e.dataTransfer.types.includes("Files")) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        const file = fileFromTransfer(e.dataTransfer);
        if (file) void handleReplace(file);
      }}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={`block ${size} rounded-md overflow-hidden border-2 transition-colors ${
              dragOver
                ? "border-primary"
                : "border-transparent hover:border-primary/50"
            }`}
          >
            <img
              src={image.dataUrl}
              alt={t("composer.attachmentPreview")}
              className="size-full object-cover"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-36">
          <DropdownMenuItem
            onClick={() => inputRef.current?.click()}
          >
            <ImageIcon className="size-3.5" />
            {t("composer.replaceImage")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onRemove(index)}
          >
            <X className="size-3.5" />
            {t("composer.clearImage")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleReplace(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
