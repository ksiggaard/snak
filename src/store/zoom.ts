import { create } from "zustand";
import {
  applyZoom,
  clampZoom,
  getStoredZoom,
  storeZoom,
  ZOOM_DEFAULT,
  ZOOM_STEP,
} from "@/lib/zoom";

interface ZoomState {
  /** Webview zoom factor (1 = 100%). */
  zoom: number;
  setZoom: (z: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

export const useZoom = create<ZoomState>((set, get) => ({
  zoom: getStoredZoom(),

  setZoom: (z) => {
    const v = clampZoom(z);
    storeZoom(v);
    applyZoom(v);
    set({ zoom: v });
  },

  zoomIn: () => get().setZoom(get().zoom + ZOOM_STEP),
  zoomOut: () => get().setZoom(get().zoom - ZOOM_STEP),
  resetZoom: () => get().setZoom(ZOOM_DEFAULT),
}));
