// Sample snak runtime plugin (plain ESM — no build step; copied as-is).
// Demonstrates the plugin API: a header UI-slot button backed by scoped storage,
// plus a lifecycle cleanup. The host calls `activate(ctx)` after loading this.

export function activate(ctx) {
  ctx.ui.registerUi("header", (el) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = "Hello plugin — click to count";
    btn.style.cssText =
      "height:1.75rem;padding:0 .5rem;margin-right:.25rem;border-radius:.375rem;font-size:12px;line-height:1;cursor:pointer;background:transparent;color:inherit;";

    let clicks = 0;
    const render = () => {
      btn.textContent = clicks > 0 ? `👋 ${clicks}` : "👋";
    };
    render();
    if (ctx.storage) {
      void ctx.storage.get("clicks").then((v) => {
        clicks = Number(v ?? "0") || 0;
        render();
      });
    }

    const onClick = () => {
      clicks += 1;
      render();
      void ctx.storage?.set("clicks", String(clicks));
    };
    btn.addEventListener("click", onClick);
    el.appendChild(btn);

    return () => btn.removeEventListener("click", onClick);
  });
}
