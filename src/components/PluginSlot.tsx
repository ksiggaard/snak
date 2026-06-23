// Renders the UI a runtime plugin contributed to a named slot. Plugins hand the
// host a `mount(el) => cleanup` function (no shared React instance — see
// pluginApi.ts), so each item gets a container element the host mounts into and
// tears down on unmount/disable.

import { useEffect, useRef } from "react";
import { useContributions, EMPTY_UI, type UiItem } from "@/store/contributions";

export function PluginSlot({ name }: { name: string }) {
  const items = useContributions((s) => s.uiSlots[name] ?? EMPTY_UI);
  if (items.length === 0) return null;
  return (
    <>
      {items.map((item, i) => (
        <MountPoint key={`${item.pluginId}:${i}`} item={item} />
      ))}
    </>
  );
}

/** Renders one plugin contribution into a container element. The mount's
 * returned cleanup (if any) runs on unmount/disable, then the container is
 * cleared so no orphan DOM survives a plugin reload. */
function MountPoint({ item }: { item: UiItem }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cleanup: void | (() => void);
    try {
      cleanup = item.mount(el);
    } catch (e) {
      console.error(`[plugin ${item.pluginId}] UI mount threw`, e);
    }
    return () => {
      try {
        if (typeof cleanup === "function") cleanup();
      } catch (e) {
        console.error(`[plugin ${item.pluginId}] UI cleanup threw`, e);
      }
      el.replaceChildren();
    };
  }, [item]);
  // `display: contents` so the wrapper doesn't perturb the slot's flex/grid layout.
  return <span ref={ref} className="contents" />;
}
