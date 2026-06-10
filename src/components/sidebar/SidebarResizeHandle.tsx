import { useRef } from "react";
import { useLayout } from "@/store/layout";

/** Drag handle on the sidebar's right edge (T22). Resizes the sidebar live
 *  (clamped to MIN..MAX in the store) and persists the chosen width. Width
 *  updates are coalesced to one per animation frame to avoid layout thrash. */
export function SidebarResizeHandle() {
  const setSidebarWidth = useLayout((s) => s.setSidebarWidth);
  const frame = useRef<number | null>(null);
  const latest = useRef(0);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const aside = e.currentTarget.parentElement;
    if (!aside) return;
    const left = aside.getBoundingClientRect().left;

    const apply = () => {
      frame.current = null;
      setSidebarWidth(latest.current);
    };
    const onMove = (ev: PointerEvent) => {
      latest.current = ev.clientX - left;
      if (frame.current == null) frame.current = requestAnimationFrame(apply);
    };
    const onUp = (ev: PointerEvent) => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
      frame.current = null;
      setSidebarWidth(ev.clientX - left);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.removeProperty("cursor");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    // Keep the resize cursor while dragging over the rest of the page.
    document.body.style.cursor = "col-resize";
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      onPointerDown={onPointerDown}
      className="hover:bg-sidebar-ring/60 absolute inset-y-0 -right-1 z-20 hidden w-2 cursor-col-resize md:block"
    />
  );
}
