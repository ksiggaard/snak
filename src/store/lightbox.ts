import { create } from "zustand";
import type { MessageImage } from "@/lib/messages";

// Shared full-size viewer (T44). A single `<ImageLightbox>` is mounted at the
// app root (like `ConfirmDialog`); the message list, the right-side chat panel,
// and rendered Mermaid diagrams all open it through this store rather than each
// owning a copy. Content is either a stored image (base64) or a rendered SVG
// diagram. When `messageId` is set the viewer also offers a "Go to message"
// jump (used by the panel's media gallery); other openers pass none.

export type LightboxContent =
  | { kind: "image"; image: MessageImage }
  | { kind: "svg"; svg: string };

interface LightboxState {
  content: LightboxContent | null;
  messageId: string | null;
  openImage: (image: MessageImage, messageId?: string | null) => void;
  openSvg: (svg: string) => void;
  close: () => void;
}

export const useLightbox = create<LightboxState>((set) => ({
  content: null,
  messageId: null,
  openImage: (image, messageId = null) =>
    set({ content: { kind: "image", image }, messageId }),
  openSvg: (svg) => set({ content: { kind: "svg", svg }, messageId: null }),
  close: () => set({ content: null, messageId: null }),
}));

/** Imperative helper: open a stored image (optionally with a message to jump to). */
export const openLightbox = (
  image: MessageImage,
  messageId?: string | null,
): void => useLightbox.getState().openImage(image, messageId);

/** Imperative helper: open a rendered SVG diagram full-size. */
export const openLightboxSvg = (svg: string): void =>
  useLightbox.getState().openSvg(svg);
