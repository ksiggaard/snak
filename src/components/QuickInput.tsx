import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { Camera, Check, ChevronsUpDown, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TooltipProvider } from "@/components/ui/tooltip";
import { prepareImage, type PreparedImage } from "@/lib/image";
import {
  hideQuick,
  submitQuick,
  takeScreenshot,
  setQuickHeight,
} from "@/lib/quick";
import {
  QUICK_RECENTS_EVENT,
  cycleDestination,
  destinationThreadId,
  type QuickRecent,
} from "@/lib/quickDestinations";
import { getSetting } from "@/lib/db";
import {
  DEFAULT_PROVIDER_KEY,
  DEFAULT_MODEL_KEY,
  resolveDefault,
} from "@/store/threads";
import { usePlugins } from "@/store/plugins";
import { useModels } from "@/store/models";
import { useKeys } from "@/store/keys";
import { useConnectivity, useIsOffline } from "@/store/connectivity";
import { useI18n, useT } from "@/store/i18n";
import { PROVIDERS, useProviders, withKeylessProviders } from "@/lib/providers";
import { buildModelOptions, currentModelLabel } from "@/lib/modelOptions";
import { cn } from "@/lib/utils";
import type { Provider } from "@/types/db";

/** Overlay window minimum height (matches the Rust clamp floor). */
const QUICK_MIN_HEIGHT = 120;

async function screenshotToImage(base64Png: string): Promise<PreparedImage> {
  const res = await fetch(`data:image/png;base64,${base64Png}`);
  return prepareImage(await res.blob());
}

export function QuickInput() {
  const t = useT();
  const [text, setText] = useState("");
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider>(PROVIDERS[0].id);
  const [model, setModel] = useState<string>(PROVIDERS[0].defaultModel);
  // Destination picker (T31): index 0 = "New chat", 1..n = recent threads.
  const [recents, setRecents] = useState<QuickRecent[]>([]);
  const [destIndex, setDestIndex] = useState(0);
  // Which toolbar dropdown is open (only one at a time). The lists render
  // in-flow (above the toolbar) so the overlay window grows to contain them —
  // a frameless overlay can't show an OS popup outside its own rectangle.
  const [openChooser, setOpenChooser] = useState<
    "none" | "destination" | "model"
  >("none");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Model options for the in-flow model dropdown (mirrors ModelChooser): a
  // provider contributes models only if enabled AND keyed (a stored key, or a
  // keyless local provider like Ollama). null while key presence is loading.
  const providers = useProviders();
  const models = useModels((s) => s.models);
  const present = useKeys((s) => s.present);
  const keysLoaded = useKeys((s) => s.loaded);
  const keyed = keysLoaded ? withKeylessProviders(present, providers) : null;
  const offline = useIsOffline();
  const modelOptions =
    keyed === null
      ? []
      : buildModelOptions(providers, keyed, models, { provider, model }, offline);
  const modelGroups: { providerLabel: string; items: typeof modelOptions }[] =
    [];
  for (const o of modelOptions) {
    const g = modelGroups.find((x) => x.providerLabel === o.providerLabel);
    if (g) g.items.push(o);
    else modelGroups.push({ providerLabel: o.providerLabel, items: [o] });
  }
  const modelLabel = currentModelLabel(
    providers,
    models,
    provider,
    model,
  ).label;
  const destLabel =
    destIndex === 0
      ? t("quick.newChat")
      : (recents[destIndex - 1]?.title ?? t("quick.newChat"));

  // This window doesn't run App's init, so load the data the model chooser needs
  // (enabled providers + models), and seed the selection from the persisted default.
  useEffect(() => {
    let active = true;
    void usePlugins.getState().load();
    void useModels.getState().load();
    void useKeys.getState().load();
    // Detect connectivity in this window too (separate store instance) so the
    // model chooser greys out cloud providers when offline (offline mode).
    void useConnectivity.getState().init();
    // Bundled language packs apply synchronously; this folds in user packs.
    void useI18n.getState().loadUserPacks();
    void Promise.all([
      getSetting(DEFAULT_PROVIDER_KEY),
      getSetting(DEFAULT_MODEL_KEY),
    ]).then(([dp, dm]) => {
      if (!active) return;
      const def = resolveDefault(dp, dm);
      setProvider(def.provider);
      setModel(def.model);
    });
    return () => {
      active = false;
    };
  }, []);

  // Recent destination threads (T31). Rust `show_quick` asks the main window,
  // which answers by emitting this event to the overlay — so the list refreshes
  // on every show and this window stays DB-free. Each show is a fresh
  // interaction, so the selection resets to "New chat" (which also clamps a
  // selection that pointed at a since-deleted thread).
  useEffect(() => {
    const unlisten = listen<QuickRecent[]>(QUICK_RECENTS_EVENT, (e) => {
      setRecents(e.payload);
      setDestIndex(0);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // Size the overlay window to fit the panel (Rust clamps to [min, max]). Ceil
  // the measured (possibly fractional) height so the window is never a sub-pixel
  // short of the content; +16 accounts for the p-2 margin (8px top + bottom).
  const syncHeight = useCallback(() => {
    const el = panelRef.current;
    if (el)
      void setQuickHeight(Math.ceil(el.getBoundingClientRect().height) + 16);
  }, []);

  // Focus the field whenever the overlay gains focus (i.e. each time it's shown),
  // and re-sync the height then too — the ResizeObserver only fires on content
  // size *changes*, so an unchanged panel shown after a prior resize could
  // otherwise stay too small on launch.
  useEffect(() => {
    textareaRef.current?.focus();
    syncHeight();
    const unlisten = getCurrentWindow().onFocusChanged(({ payload }) => {
      if (payload) {
        textareaRef.current?.focus();
        syncHeight();
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [syncHeight]);

  // Grow/shrink the overlay on every content change (textarea growth, previews,
  // error, recents arriving after show).
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(syncHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncHeight]);

  // Return focus to the textarea whenever a dropdown closes (after a pick, a
  // toggle, or Escape) so the user can keep typing — the option <button> that
  // was clicked unmounts with the list, so focus would otherwise fall to body.
  useEffect(() => {
    if (openChooser === "none") textareaRef.current?.focus();
  }, [openChooser]);

  function pickDestination(index: number) {
    setDestIndex(index);
    setOpenChooser("none");
  }

  function pickModel(p: Provider, m: string) {
    setProvider(p);
    setModel(m);
    setOpenChooser("none");
  }

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
    setError(null);
    try {
      const base64 = await takeScreenshot();
      if (base64) {
        const img = await screenshotToImage(base64);
        setImages((prev) => [...prev, img]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      textareaRef.current?.focus();
    }
  }

  function reset() {
    setText("");
    setImages([]);
    setError(null);
    setDestIndex(0);
    void setQuickHeight(QUICK_MIN_HEIGHT);
  }

  async function submit() {
    const trimmed = text.trim();
    if (busy || (!trimmed && images.length === 0)) return;
    await submitQuick({
      text: trimmed,
      images,
      provider,
      model,
      thread_id: destinationThreadId(recents, destIndex),
    });
    reset();
  }

  async function cancel() {
    reset();
    await hideQuick();
  }

  // Drag the frameless overlay by pressing its empty background — the panel's
  // own padding/gaps or the toolbar spacer (target === currentTarget), never
  // the textarea, buttons, or image previews (which are nested children).
  function startDrag(e: MouseEvent<HTMLDivElement>) {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    void getCurrentWindow().startDragging();
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen items-start justify-center p-2">
        <div
          ref={panelRef}
          onMouseDown={startDrag}
          className="bg-popover text-popover-foreground flex w-full cursor-grab flex-col gap-2 rounded-xl border p-3 shadow-2xl active:cursor-grabbing"
        >
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {images.map((img, i) => (
                <div key={i} className="relative">
                  <img
                    src={img.dataUrl}
                    alt={t("composer.attachmentPreview")}
                    className="size-14 rounded-md object-cover"
                  />
                  <button
                    type="button"
                    aria-label={t("composer.removeImage")}
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

          {error && <p className="text-destructive px-1 text-xs">{error}</p>}

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
                // Escape closes an open dropdown first, then cancels the overlay.
                if (openChooser !== "none") setOpenChooser("none");
                else void cancel();
              } else if (
                e.key === "Tab" ||
                (e.ctrlKey && (e.key === "ArrowUp" || e.key === "ArrowDown"))
              ) {
                // Cycle the destination without leaving the textarea (T31):
                // Tab forward, Shift+Tab / Ctrl+Up backward, Ctrl+Down forward.
                e.preventDefault();
                const dir = e.shiftKey || e.key === "ArrowUp" ? -1 : 1;
                setDestIndex((i) => cycleDestination(i, recents.length, dir));
              }
            }}
            placeholder={t("quick.placeholder")}
            className="max-h-[320px] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
            autoFocus
          />

          {/* Destination dropdown (T31): New chat + up to 5 recent threads.
              Rendered in-flow above the toolbar so the overlay window grows to
              fit it (opens "upward" since the overlay sits low on screen). */}
          {openChooser === "destination" && (
            <ChooserList ariaLabel={t("quick.destination")}>
              <ChooserOption
                label={t("quick.newChat")}
                selected={destIndex === 0}
                onSelect={() => pickDestination(0)}
              />
              {recents.map((r, i) => (
                <ChooserOption
                  key={r.id}
                  label={r.title}
                  selected={destIndex === i + 1}
                  onSelect={() => pickDestination(i + 1)}
                />
              ))}
            </ChooserList>
          )}

          {/* Model dropdown (only when starting a new chat — an existing thread
              keeps its saved provider/model). */}
          {openChooser === "model" && destIndex === 0 && (
            <ChooserList ariaLabel={t("model.aria")}>
              {keyed === null ? (
                <div className="text-muted-foreground px-2 py-1.5 text-sm">
                  {t("common.loading")}
                </div>
              ) : (
                modelGroups.map((g, gi) => (
                  <div key={g.providerLabel}>
                    {gi > 0 && <div className="bg-border -mx-1 my-1 h-px" />}
                    <div className="text-muted-foreground px-1.5 py-1 text-xs font-medium">
                      {g.providerLabel}
                    </div>
                    {g.items.map((o) => (
                      <ChooserOption
                        key={`${o.provider}:${o.modelId}`}
                        label={o.label}
                        selected={
                          o.provider === provider && o.modelId === model
                        }
                        disabled={!o.active}
                        hint={
                          !o.active
                            ? t(
                                o.reason === "offline"
                                  ? "model.offline"
                                  : "model.unavailable",
                              )
                            : undefined
                        }
                        onSelect={() => pickModel(o.provider, o.modelId)}
                      />
                    ))}
                  </div>
                ))
              )}
            </ChooserList>
          )}

          <div className="flex items-center gap-2">
            <ImagePicker onFiles={addFiles} disabled={busy} />
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("quick.takeScreenshot")}
              disabled={busy}
              onClick={() => void screenshot()}
            >
              <Camera className="size-4" />
            </Button>
            <div
              className="flex-1 cursor-grab self-stretch active:cursor-grabbing"
              onMouseDown={startDrag}
            />
            <ChooserTrigger
              label={destLabel}
              ariaLabel={t("quick.destination")}
              open={openChooser === "destination"}
              onToggle={() =>
                setOpenChooser((o) =>
                  o === "destination" ? "none" : "destination",
                )
              }
            />
            {destIndex === 0 && (
              <ChooserTrigger
                label={modelLabel}
                ariaLabel={t("model.choose")}
                open={openChooser === "model"}
                onToggle={() =>
                  setOpenChooser((o) => (o === "model" ? "none" : "model"))
                }
              />
            )}
            <Button
              onClick={() => void submit()}
              disabled={
                busy || (text.trim().length === 0 && images.length === 0)
              }
            >
              {destIndex === 0 ? t("quick.startChat") : t("common.send")}
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

/**
 * A toolbar dropdown trigger styled like the chat `ModelChooser` button (T31):
 * the current value plus a chevron. Not focusable (tabIndex -1) so Tab keeps
 * cycling the destination from the textarea without stealing the typing flow.
 */
function ChooserTrigger({
  label,
  ariaLabel,
  open,
  onToggle,
}: {
  label: string;
  ariaLabel: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label={ariaLabel}
      title={label}
      onClick={onToggle}
      className="text-muted-foreground hover:text-foreground hover:bg-accent flex items-center gap-1 rounded-md px-2 py-1 text-sm transition-colors"
    >
      <span className="text-foreground max-w-40 truncate">{label}</span>
      <ChevronsUpDown className="size-3 shrink-0 opacity-60" />
    </button>
  );
}

/** In-flow listbox container matching the chat `ModelChooser` popover, with an
 *  internal scroll cap so long lists never grow the overlay unbounded. */
function ChooserList({
  ariaLabel,
  children,
}: {
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <div
      role="listbox"
      aria-label={ariaLabel}
      className="bg-popover text-popover-foreground ring-foreground/10 max-h-52 overflow-y-auto rounded-lg p-1 ring-1"
    >
      {children}
    </div>
  );
}

/** One option row in a `ChooserList`, mirroring the chat ModelChooser option. */
function ChooserOption({
  label,
  selected,
  disabled,
  hint,
  onSelect,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  hint?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      onClick={onSelect}
      title={label}
      className="hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-sm disabled:pointer-events-none disabled:opacity-50"
    >
      <Check
        className={cn(
          "size-4 shrink-0",
          selected ? "opacity-100" : "opacity-0",
        )}
      />
      <span className="flex-1 truncate text-left">{label}</span>
      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
    </button>
  );
}

function ImagePicker({
  onFiles,
  disabled,
}: {
  onFiles: (files: Iterable<File>) => void;
  disabled?: boolean;
}) {
  const t = useT();
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
        variant="ghost"
        size="icon"
        aria-label={t("composer.attachImage")}
        disabled={disabled}
        onClick={() => ref.current?.click()}
      >
        <Paperclip className="size-4" />
      </Button>
    </>
  );
}
