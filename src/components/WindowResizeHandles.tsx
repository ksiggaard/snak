import { getCurrentWindow } from "@tauri-apps/api/window";

// `ResizeDirection` is declared but not exported by the Tauri API package, so
// mirror its string union here (matches the method's accepted values).
type ResizeDirection =
  | "North"
  | "NorthEast"
  | "East"
  | "SouthEast"
  | "South"
  | "SouthWest"
  | "West"
  | "NorthWest";

// In custom title-bar mode the window is decorationless, so on Linux/KDE there
// is no native resize grip — the only resize target is the exact 1px edge.
// These transparent handles widen that target to a comfortable band around the
// whole perimeter and drive Tauri's `startResizeDragging`. Mounted only in
// custom mode (see App); native mode lets the OS own resize.

// Thickness of the edge bands / size of the corner squares, in px. Corners sit
// above the edges (higher z-index) so the corner direction wins near corners.
const EDGE = 6;
const CORNER = 12;

function startResize(direction: ResizeDirection) {
  return (e: React.MouseEvent) => {
    // Left button only — don't hijack right/middle clicks.
    if (e.button !== 0) return;
    e.preventDefault();
    void getCurrentWindow().startResizeDragging(direction);
  };
}

export function WindowResizeHandles() {
  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      {/* Edges */}
      <div
        className="pointer-events-auto absolute top-0 right-0 left-0 cursor-ns-resize"
        style={{ height: EDGE }}
        onMouseDown={startResize("North")}
      />
      <div
        className="pointer-events-auto absolute right-0 bottom-0 left-0 cursor-ns-resize"
        style={{ height: EDGE }}
        onMouseDown={startResize("South")}
      />
      <div
        className="pointer-events-auto absolute top-0 bottom-0 left-0 cursor-ew-resize"
        style={{ width: EDGE }}
        onMouseDown={startResize("West")}
      />
      <div
        className="pointer-events-auto absolute top-0 right-0 bottom-0 cursor-ew-resize"
        style={{ width: EDGE }}
        onMouseDown={startResize("East")}
      />

      {/* Corners (above the edges) */}
      <div
        className="pointer-events-auto absolute top-0 left-0 cursor-nwse-resize"
        style={{ width: CORNER, height: CORNER }}
        onMouseDown={startResize("NorthWest")}
      />
      <div
        className="pointer-events-auto absolute top-0 right-0 cursor-nesw-resize"
        style={{ width: CORNER, height: CORNER }}
        onMouseDown={startResize("NorthEast")}
      />
      <div
        className="pointer-events-auto absolute bottom-0 left-0 cursor-nesw-resize"
        style={{ width: CORNER, height: CORNER }}
        onMouseDown={startResize("SouthWest")}
      />
      <div
        className="pointer-events-auto absolute right-0 bottom-0 cursor-nwse-resize"
        style={{ width: CORNER, height: CORNER }}
        onMouseDown={startResize("SouthEast")}
      />
    </div>
  );
}
