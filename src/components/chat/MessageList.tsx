import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  BookOpenText,
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileJson,
  FileText,
  FoldHorizontal,
  FoldVertical,
  Globe,
  Loader2,
  RefreshCw,
  Square,
  Telescope,
  TriangleAlert,
  UnfoldHorizontal,
  Volume2,
  Wrench,
} from "lucide-react";
import {
  imageDataUrl,
  type ApiTraceEntry,
  type MessageSubagent,
  type MessageToolCall,
  type MessageView,
} from "@/lib/messages";
import { cn } from "@/lib/utils";
import { openExternal } from "@/lib/openExternal";
import { Markdown } from "@/components/chat/Markdown";
import { ArtifactCard } from "@/components/chat/ArtifactCard";
import { ArtifactContext } from "@/components/chat/artifactContext";
import { ModelBadge } from "@/components/chat/ModelBadge";
import { PlanPanel } from "@/components/chat/PlanPanel";
import { parseArtifact } from "@/lib/artifacts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BotAvatar } from "@/components/bots/BotAvatar";
import { EmptySuggestions } from "@/components/chat/EmptySuggestions";
import { useBots } from "@/store/bots";
import { STREAM_ID, useThreads } from "@/store/threads";
import { openLightbox } from "@/store/lightbox";
import { useSearch } from "@/store/search";
import { useAppearance } from "@/store/appearance";
import { timeLabels, useIntlLocale, useT, type MessageKey } from "@/store/i18n";
import {
  CHAT_CONTAINER_CLASSES,
  styleClasses,
  type ChatStyle,
} from "@/lib/appearance";
import { formatDuration, parseDbTime, relativeTime } from "@/lib/time";
import { imageLabel } from "@/lib/imageLabels";
import { audioEnabled, hasRenderer } from "@/lib/plugins";
import {
  extractSpeakableText,
  playSentences,
  playWav,
  ttsSynthesize,
  type Playback,
} from "@/lib/audio";
import {
  buildRange,
  clearReadAlongHighlight,
  collectProse,
  readAlongSupported,
  setReadAlongHighlight,
  splitSentenceRanges,
} from "@/lib/readAlong";
import { useAudio } from "@/store/audio";
import {
  LOADING_MESSAGE_KEYS,
  pickLoadingMessage,
} from "@/lib/loadingMessages";
import {
  embeddedYouTubeIds,
  mediaLabelOffsets,
  parseYouTubeUrl,
  partitionVideoThumbs,
  type YouTubeVideoOption,
} from "@/lib/youtube";
import { YouTubeEmbed } from "@/components/chat/YouTubeEmbed";
import { selectRegistry, usePlugins } from "@/store/plugins";
import type { Bot } from "@/types/db";

interface MessageListProps {
  messages: MessageView[];
  pending?: boolean;
  busy?: boolean;
  /** Bot persona of this thread (T38) — assistant messages render its avatar
   *  + name. null/undefined (no bot) leaves rendering unchanged. */
  bot?: Bot | null;
  /** Top inset (px) reserved as a spacer so the first message clears the
   *  overlaid ChatTopBar. */
  topInset?: number;
}

/**
 * A distinct, non-message indicator that the model invoked a tool (e.g. the
 * built-in web browser). Deliberately styled unlike a chat bubble — a bordered
 * pill with an icon and the fetched URL — so it reads as system chrome the model
 * itself can't produce, and makes it evident how the model found its answer.
 */
/** Pretty-print a tool's input arguments for the expanded panel, or null when
 * there's nothing worth showing (no input, or an empty object). */
function formatToolArgs(args: unknown): string | null {
  if (args === undefined || args === null) return null;
  if (typeof args === "object" && Object.keys(args as object).length === 0)
    return null;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return null;
  }
}

function ToolActivity({ call }: { call: MessageToolCall }) {
  const t = useT();
  const isFetch = call.name === "web__fetch_url";
  const label = isFetch ? (call.url ?? t("chat.webPage")) : call.name;
  const running = call.running === true;
  const failed = call.ok === false;
  // A disclosure panel exists for tools that carry input arguments, a
  // command/output (system diagnostics), or web sources (search hits / fetched
  // page); bare calls keep the simple pill.
  const hasSources = Boolean(call.sources && call.sources.length > 0);
  const argsText = formatToolArgs(call.arguments);
  const hasPanel = Boolean(
    call.command || call.output || hasSources || argsText,
  );
  // Auto-expanded while the tool runs (the live terminal view); collapsed once
  // it finishes, with a click to re-open and review what ran.
  const [open, setOpen] = useState(false);
  const expanded = running || open;

  // Keep the streaming output pinned to the latest line as it grows.
  const outRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (expanded && outRef.current)
      outRef.current.scrollTop = outRef.current.scrollHeight;
  }, [call.output, expanded]);

  const Icon = running
    ? Loader2
    : failed
      ? TriangleAlert
      : isFetch
        ? Globe
        : Wrench;
  const header = (
    <>
      <Icon
        className={cn(
          "size-3 shrink-0",
          running && "animate-spin",
          failed && "text-destructive",
        )}
        aria-hidden
      />
      <span className="text-foreground/90 truncate font-mono">{label}</span>
      {running && (
        <span className="text-muted-foreground shrink-0">
          {t("chat.toolRunning")}
        </span>
      )}
      {!running && hasPanel && (
        <ChevronRight
          className={cn(
            "size-3 shrink-0 transition-transform",
            expanded && "rotate-90",
          )}
          aria-hidden
        />
      )}
    </>
  );

  // Non-expandable pill (web fetch / bare call): unchanged from before.
  if (!hasPanel && !running) {
    return (
      <div
        title={label}
        className="border-border bg-background/70 text-muted-foreground flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
      >
        {header}
      </div>
    );
  }

  return (
    <div className="border-border bg-background/70 max-w-full overflow-hidden rounded-md border text-xs">
      <button
        type="button"
        onClick={() => !running && setOpen((o) => !o)}
        disabled={running}
        title={label}
        className={cn(
          "text-muted-foreground flex w-full items-center gap-1.5 px-2 py-1",
          !running && "hover:bg-muted/50 cursor-pointer",
        )}
      >
        {header}
      </button>
      {expanded && (
        <div className="border-border/60 border-t">
          {argsText && (
            <div className="border-border/40 border-b">
              <div className="text-muted-foreground px-2 pt-1 text-[10px] font-semibold tracking-wide uppercase select-none">
                {t("chat.toolArguments")}
              </div>
              <pre className="text-foreground/80 max-h-48 overflow-auto px-2 pb-1 font-mono text-[11px] leading-snug whitespace-pre-wrap">
                {argsText}
              </pre>
            </div>
          )}
          {call.command && (
            <div className="text-foreground/80 bg-muted/30 px-2 py-1 font-mono break-all">
              <span className="text-muted-foreground select-none">$ </span>
              {call.command}
            </div>
          )}
          {call.output ? (
            <pre
              ref={outRef}
              className="text-foreground/80 max-h-64 overflow-auto px-2 py-1 font-mono text-[11px] leading-snug whitespace-pre-wrap"
            >
              {call.output}
            </pre>
          ) : (
            running &&
            !hasSources && (
              <div className="text-muted-foreground px-2 py-1">
                {t("chat.toolWorking")}
              </div>
            )
          )}
          {hasSources && (
            <ul className="divide-border/60 max-h-64 divide-y overflow-auto">
              {call.sources!.map((s, i) => (
                <li key={`${s.url}-${i}`} className="px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => void openExternal(s.url)}
                    title={s.url}
                    className="text-primary block max-w-full cursor-pointer truncate text-left hover:underline"
                  >
                    {s.title?.trim() || s.url}
                  </button>
                  {s.snippet && (
                    <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug break-words">
                      {s.snippet}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One research subagent (deep research mode, T55), rendered like a tool-activity
 * panel: a collapsible card showing the subtask, a live status (spinner while
 * dispatched/running, a telescope when done, a warning when failed), and — once
 * done — the subagent's concise summary as Markdown. Structured system chrome the
 * model can't fabricate, mirroring `ToolActivity`.
 */
function SubagentCard({ sub }: { sub: MessageSubagent }) {
  const t = useT();
  const running = sub.status === "dispatched" || sub.status === "running";
  const failed = sub.status === "failed";
  const hasSummary = Boolean(sub.summary && sub.summary.trim());
  const [open, setOpen] = useState(false);
  const expanded = open && hasSummary;
  const Icon = running ? Loader2 : failed ? TriangleAlert : Telescope;
  const status = running
    ? t("chat.subagentResearching")
    : failed
      ? t("chat.subagentFailed")
      : t("chat.subagentDone");

  return (
    <div className="border-border bg-background/70 w-full max-w-full overflow-hidden rounded-md border text-xs">
      <button
        type="button"
        onClick={() => hasSummary && setOpen((o) => !o)}
        disabled={!hasSummary}
        title={sub.task}
        className={cn(
          "text-muted-foreground flex w-full items-center gap-1.5 px-2 py-1",
          hasSummary && "hover:bg-muted/50 cursor-pointer",
        )}
      >
        <Icon
          className={cn(
            "size-3 shrink-0",
            running && "animate-spin",
            failed && "text-destructive",
          )}
          aria-hidden
        />
        <span className="text-foreground/90 flex-1 truncate text-left">
          {sub.task || t("chat.subagent")}
        </span>
        <span className="text-muted-foreground shrink-0">{status}</span>
        {hasSummary && (
          <ChevronRight
            className={cn(
              "size-3 shrink-0 transition-transform",
              expanded && "rotate-90",
            )}
            aria-hidden
          />
        )}
      </button>
      {expanded && (
        <div className="border-border/60 text-foreground/80 border-t px-2 py-1.5">
          <Markdown content={sub.summary!} />
        </div>
      )}
    </div>
  );
}

/**
 * The model's captured reasoning / extended thinking (when reasoning capture is
 * on), rendered like a tool-activity panel: a collapsible "Reasoning" disclosure
 * showing the thinking as Markdown. Lets the user see *how* the model reached
 * its answer without cluttering the reply. Collapsed by default.
 */
function ReasoningPanel({ reasoning }: { reasoning: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="border-border bg-background/70 w-full max-w-prose overflow-hidden rounded-md border text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-muted-foreground hover:bg-muted/50 flex w-full cursor-pointer items-center gap-1.5 px-2 py-1"
      >
        <Brain className="size-3 shrink-0" aria-hidden />
        <span className="text-foreground/90 flex-1 text-left">
          {t("chat.reasoning")}
        </span>
        <ChevronRight
          className={cn(
            "size-3 shrink-0 transition-transform",
            open && "rotate-90",
          )}
          aria-hidden
        />
      </button>
      {open && (
        <div className="border-border/60 text-foreground/80 border-t px-2 py-1.5">
          <Markdown content={reasoning} />
        </div>
      )}
    </div>
  );
}

/**
 * The raw per-round API trace (when trace capture is on): a collapsible
 * developer panel listing each request body (redacted) and response summary,
 * pretty-printed. Structured system chrome the model can't fabricate.
 */
function ApiTracePanel({ trace }: { trace: ApiTraceEntry[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="border-border bg-background/70 w-full max-w-prose overflow-hidden rounded-md border text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-muted-foreground hover:bg-muted/50 flex w-full cursor-pointer items-center gap-1.5 px-2 py-1"
      >
        <FileJson className="size-3 shrink-0" aria-hidden />
        <span className="text-foreground/90 flex-1 text-left">
          {t("chat.apiTrace")}
        </span>
        <span className="text-muted-foreground shrink-0">{trace.length}</span>
        <ChevronRight
          className={cn(
            "size-3 shrink-0 transition-transform",
            open && "rotate-90",
          )}
          aria-hidden
        />
      </button>
      {open && (
        <div className="border-border/60 divide-border/60 divide-y border-t">
          {trace.map((e, i) => (
            <div key={i} className="px-2 py-1">
              <div className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase select-none">
                {t(
                  e.phase === "request"
                    ? "chat.apiTraceRequest"
                    : "chat.apiTraceResponse",
                  { round: e.round + 1 },
                )}
              </div>
              <pre className="text-foreground/80 max-h-72 overflow-auto font-mono text-[11px] leading-snug whitespace-pre-wrap">
                {JSON.stringify(e.data, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Small footer under an assistant reply: relative time + generation duration
 * + a copy-to-clipboard button for the whole reply. Hidden for the streaming
 * placeholder (empty created_at). `now` is supplied by the parent's ticker so
 * the relative label stays current. */
function AssistantMeta({
  createdAt,
  durationMs,
  content,
  speak,
  trailing,
  onToggleWide,
  wide,
}: {
  createdAt: string;
  durationMs: number | null;
  /** The reply's raw Markdown, copied verbatim. */
  content: string;
  /** Speak button (audio plugin), rendered right next to the copy button. */
  speak?: React.ReactNode;
  /** Inline controls rendered after the copy button (T54 variation controls). */
  trailing?: React.ReactNode;
  /** When provided, renders the full-width toggle (cap is on + assistant reply). */
  onToggleWide?: () => void;
  /** Whether this reply is currently expanded to full width. */
  wide?: boolean;
}) {
  const t = useT();
  const now = useNow();
  // Active-locale formatting (T32): labels + Intl locale follow the language.
  const locale = useIntlLocale();
  const [copied, setCopied] = useState(false);
  if (!createdAt) return null;
  const date = parseDbTime(createdAt);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable (e.g. no permission); ignore silently.
    }
  };

  return (
    <div
      className="text-muted-foreground flex items-center gap-1.5 text-xs"
      title={date.toLocaleString(locale)}
    >
      <span>
        {relativeTime(date, new Date(now), timeLabels(), locale)}
        {durationMs != null && ` · ${formatDuration(durationMs)}`}
      </span>
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? t("chat.copied") : t("chat.copy")}
        title={copied ? t("chat.copied") : t("chat.copy")}
        className="hover:bg-muted hover:text-foreground rounded p-1 transition-colors"
      >
        {copied ? (
          <Check className="size-3.5" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
      </button>
      {speak}
      {onToggleWide && (
        <button
          type="button"
          onClick={onToggleWide}
          aria-label={wide ? t("chat.exitFullWidth") : t("chat.fullWidth")}
          title={wide ? t("chat.exitFullWidth") : t("chat.fullWidth")}
          className="hover:bg-muted hover:text-foreground rounded p-1 transition-colors"
        >
          {wide ? (
            <FoldHorizontal className="size-3.5" aria-hidden />
          ) : (
            <UnfoldHorizontal className="size-3.5" aria-hidden />
          )}
        </button>
      )}
      {trailing}
    </div>
  );
}

/**
 * Modal for entering an optional steering direction before regenerating (T54).
 * Dismisses on Escape or backdrop click; Enter in the field submits. Rendered
 * via a portal so it overlays the whole window, not the message row.
 */
function DirectionModal({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (direction: string) => void;
}) {
  const t = useT();
  // Mounted only while open (see VariationControls), so the field resets to ""
  // on each open without a state-resetting effect.
  const [direction, setDirection] = useState("");

  // Escape closes the modal (matches the slash-palette/lightbox dismiss UX).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-background w-full max-w-md rounded-lg border p-4 shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold">{t("chat.newVariation")}</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          {t("chat.variationHint")}
        </p>
        <Input
          className="mt-3"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          placeholder={t("chat.directionPlaceholder")}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit(direction);
            }
          }}
          autoFocus
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={() => onSubmit(direction)} disabled={busy}>
            {t("chat.directionGenerate")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Request sources button (T56): re-asks the model to back up claims in the
 * given assistant reply with web sources, credibility ratings, and quotes.
 * Renders for every persisted (non-streaming) assistant message.
 */
function RequestSourcesButton({ messageId }: { messageId: string }) {
  const t = useT();
  const busy = useThreads((s) => {
    const id = s.currentThreadId;
    return id ? s.runningStreams.has(id) : false;
  });
  const requestSources = useThreads((s) => s.requestSources);
  return (
    <button
      type="button"
      onClick={() => void requestSources(messageId)}
      disabled={busy}
      aria-label={t("chat.requestSources")}
      title={t("chat.requestSources")}
      className="hover:bg-muted hover:text-foreground rounded p-1 transition-colors disabled:opacity-40"
    >
      <BookOpenText className="size-3.5" aria-hidden />
    </button>
  );
}

/**
 * Speak button (audio plugin): reads the reply aloud with the selected Piper
 * voice. Renders only when the audio plugin is enabled. It speaks the prose only
 * — `extractSpeakableText` strips code fences, and reasoning is a separate field
 * that never reaches `content`. Click again (or when playing) to stop.
 */
function SpeakButton({
  content,
  bodyRef,
}: {
  content: string;
  /** The rendered reply body — read-along highlights sentences inside it. */
  bodyRef?: React.RefObject<HTMLElement | null>;
}) {
  const t = useT();
  const enabled = usePlugins((s) => audioEnabled(selectRegistry(s)));
  const voice = useAudio((s) => s.ttsVoice);
  const highlightRead = useAudio((s) => s.highlightRead);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">(
    "idle",
  );
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const playbackRef = useRef<Playback | null>(null);

  useEffect(
    () => () => {
      playbackRef.current?.stop();
      clearReadAlongHighlight();
    },
    [],
  );

  if (!enabled) return null;

  const stop = () => {
    playbackRef.current?.stop();
    playbackRef.current = null;
    clearReadAlongHighlight();
    setState("idle");
  };

  const onFail = (e: unknown) => {
    clearReadAlongHighlight();
    setErrMsg(e instanceof Error ? e.message : String(e));
    setState("error");
    setTimeout(() => setState("idle"), 4000);
  };

  // Read-along: speak sentence by sentence and light each one up in place. Used
  // only when the option is on, the body is mounted, and the host supports the
  // CSS Custom Highlight API — otherwise we fall through to one-shot playback.
  const speakWithHighlight = (): boolean => {
    const root = bodyRef?.current;
    if (!highlightRead || !root || !readAlongSupported()) return false;
    const map = collectProse(root);
    const sentences = splitSentenceRanges(map.text);
    if (sentences.length === 0) return false;

    setState("loading");
    setErrMsg(null);
    playbackRef.current = playSentences(
      sentences.map((s) => s.text),
      voice,
      {
        onSentence: (i) => {
          if (i < 0) {
            playbackRef.current = null;
            clearReadAlongHighlight();
            setState("idle");
            return;
          }
          setState("playing");
          setReadAlongHighlight(
            buildRange(map, sentences[i].start, sentences[i].end),
          );
        },
        onError: onFail,
      },
    );
    return true;
  };

  const speak = async () => {
    if (state === "playing" || state === "loading") {
      stop();
      return;
    }
    if (speakWithHighlight()) return;

    const text = extractSpeakableText(content);
    if (!text) return;
    setState("loading");
    setErrMsg(null);
    try {
      const bytes = await ttsSynthesize(text, voice);
      const playback = await playWav(bytes, () => {
        playbackRef.current = null;
        setState("idle");
      });
      playbackRef.current = playback;
      setState("playing");
    } catch (e) {
      onFail(e);
    }
  };

  const label =
    state === "error"
      ? (errMsg ?? t("chat.speakError"))
      : state === "playing"
        ? t("chat.speakStop")
        : t("chat.speak");

  return (
    <button
      type="button"
      onClick={() => void speak()}
      aria-label={label}
      title={label}
      className="hover:bg-muted hover:text-foreground rounded p-1 transition-colors disabled:opacity-40"
    >
      {state === "loading" ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : state === "playing" ? (
        <Square className="size-3.5" aria-hidden />
      ) : state === "error" ? (
        <TriangleAlert className="text-destructive size-3.5" aria-hidden />
      ) : (
        <Volume2 className="size-3.5" aria-hidden />
      )}
    </button>
  );
}

/**
 * Variation controls (T54) shown inline in the latest assistant reply's meta
 * row, next to the copy button: a carousel to browse alternative variations
 * (browsing *is* selecting — the shown one is the one sent as context) and an
 * icon-only regenerate button that opens the direction modal. Renders only when
 * the reply belongs to a variant group (`m.variantIds`).
 */
function VariationControls({ m }: { m: MessageView }) {
  const t = useT();
  const busy = useThreads((s) => {
    const id = s.currentThreadId;
    return id ? s.runningStreams.has(id) : false;
  });
  const regenerate = useThreads((s) => s.regenerate);
  const selectVariant = useThreads((s) => s.selectVariant);
  const [open, setOpen] = useState(false);

  const ids = m.variantIds ?? [];
  const groupId = m.variant_group;
  if (!groupId || ids.length === 0) return null;
  const idx = ids.indexOf(m.id);
  const total = ids.length;

  const go = (delta: number) => {
    const next = idx + delta;
    if (busy || next < 0 || next >= total) return;
    void selectVariant(groupId, ids[next]);
  };

  const submit = (direction: string) => {
    if (busy) return;
    setOpen(false);
    void regenerate(m.id, direction);
  };

  return (
    <>
      {total > 1 && (
        <span
          className="flex items-center gap-0.5"
          title={t("chat.variationHint")}
        >
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={busy || idx <= 0}
            aria-label={t("chat.prevVariation")}
            title={t("chat.prevVariation")}
            className="hover:bg-muted hover:text-foreground rounded p-1 transition-colors disabled:opacity-40"
          >
            <ChevronLeft className="size-3.5" aria-hidden />
          </button>
          <span className="tabular-nums select-none">
            {idx + 1}/{total}
          </span>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={busy || idx >= total - 1}
            aria-label={t("chat.nextVariation")}
            title={t("chat.nextVariation")}
            className="hover:bg-muted hover:text-foreground rounded p-1 transition-colors disabled:opacity-40"
          >
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        </span>
      )}
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        aria-label={t("chat.newVariation")}
        title={t("chat.newVariation")}
        className="hover:bg-muted hover:text-foreground rounded p-1 transition-colors disabled:opacity-40"
      >
        <RefreshCw
          className={cn("size-3.5", busy && "animate-spin")}
          aria-hidden
        />
      </button>
      {open && (
        <DirectionModal
          busy={busy}
          onClose={() => setOpen(false)}
          onSubmit={submit}
        />
      )}
    </>
  );
}

/** One normal (non-summary) chat message, rendered per the active chat style.
 *  Presentation only — images, tool chips, Markdown body, and the assistant
 *  meta footer are identical across styles. */
const ChatMessage = memo(function ChatMessage({
  m,
  chatStyle,
  flashed,
  messageRefs,
  bot,
  mentionBot,
  latestReply,
  imageLabelStart,
  videoLabelStart,
  maxWidth,
  wide,
  onToggleWide,
}: {
  m: MessageView;
  chatStyle: ChatStyle;
  flashed: boolean;
  messageRefs: React.RefObject<Map<string, HTMLDivElement> | null>;
  bot?: Bot | null;
  /** Count of images in the thread before this message — its i-th image is
   *  labeled `imageLabel(imageLabelStart + i)` (T-image-refs). */
  imageLabelStart?: number;
  /** Count of videos (YouTube search results) before this message — its k-th
   *  video is labeled `Video ${imageLabel(videoLabelStart + k)}`. */
  videoLabelStart?: number;
  /** Persona that authored this reply via an @-mention (T43, m.bot_id) —
   *  renders with a distinct `@Name` treatment. null = normal reply. */
  mentionBot?: Bot | null;
  /** True for the thread's most recent assistant reply (T54) — the only one
   *  that shows the variation carousel + regenerate controls. */
  latestReply?: boolean;
  /** Effective max-width (px) for this row, or undefined for full width
   *  (cap off, or this reply toggled wide). Applied as inline style. */
  maxWidth?: number;
  /** Whether this reply is expanded to full width (session-only). */
  wide?: boolean;
  /** Toggle this reply's full-width state; only passed when the cap is on. */
  onToggleWide?: () => void;
}) {
  const t = useT();
  const isUser = m.role === "user";
  // Self-register the root DOM element for scroll-to-message.
  const containerRef = useRef<HTMLDivElement>(null);
  // The rendered reply body — read-along (audio plugin) walks its text to
  // highlight the spoken sentence in place. Wraps the Markdown with
  // `display:contents` so it adds no box (layout/markdown styling unchanged).
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const refs = messageRefs.current;
    if (containerRef.current) {
      refs?.set(m.id, containerRef.current);
    }
    return () => {
      refs?.delete(m.id);
    };
  }, [m.id, messageRefs]);
  // Bot persona: an @-mentioned author (T43, per-message) wins over the
  // thread's bot (T38); assistant messages show the persona's avatar + name
  // instead of the generic "ai" label. A deleted mention persona falls back
  // to the thread rendering gracefully.
  const asBot = m.role === "assistant" ? (mentionBot ?? bot) || null : null;
  // Injected one-shot reply (T43): visually distinct from the thread-persona
  // byline — the name renders as `@Name` in the accent color.
  const injected = m.role === "assistant" && mentionBot != null;
  const botName = asBot ? (injected ? `@${asBot.name}` : asBot.name) : "";

  // YouTube embeds (com.snak.youtube): a tool-result thumbnail whose source is a
  // YouTube URL is a *video* (a search result), not a picture — so it's split
  // out of the image grid and presented as a labeled video gallery ("Video A/B…")
  // that's referenceable in conversation. The in-text link for a gallery video
  // is suppressed (see suppressedVideoIds → Markdown) so we don't double-render.
  const ytEnabled = usePlugins((s) =>
    hasRenderer(selectRegistry(s), "youtube"),
  );
  const { realImages, videoOptions, activeVideoId, suppressedVideoIds } =
    useMemo(() => {
      const { images: real, videoThumbs } = partitionVideoThumbs(
        m.images,
        ytEnabled && m.role === "assistant",
      );
      const options: YouTubeVideoOption[] = videoThumbs.map((img, k) => ({
        id: parseYouTubeUrl(img.source!)!.id,
        href: img.source!,
        poster: imageDataUrl(img),
        title: img.title,
        label: `Video ${imageLabel((videoLabelStart ?? 0) + k)}`,
      }));
      // The video the message linked (if any) is the gallery's default-active.
      const ids = new Set(options.map((o) => o.id));
      const embedded = embeddedYouTubeIds(m.content).find((id) => ids.has(id));
      return {
        realImages: real,
        videoOptions: options,
        activeVideoId: embedded ?? options[0]?.id,
        suppressedVideoIds: ids,
      };
    }, [ytEnabled, m.role, m.content, m.images, videoLabelStart]);

  // A model that ignores the ```artifact fence and emits the whole artifact as
  // raw JSON / delimiter text (common with local models) still renders as an
  // artifact: detect a fence-less, whole-message artifact and show the card.
  // Computed before the early return below so the hook order stays stable.
  const wholeArtifact = useMemo(
    () =>
      // Skip the streaming placeholder: parseArtifact (JSON.parse) would run on
      // the growing text every ~100ms flush. Only the finished message matters.
      m.role === "assistant" &&
      m.id !== STREAM_ID &&
      m.content &&
      !m.content.includes("```")
        ? parseArtifact(m.content)
        : null,
    [m.role, m.id, m.content],
  );

  // Planner plan messages (route / multi_step) carry internal plan JSON and
  // are hidden from the chat — the user sees only the progress indicator and
  // the final synthesis answer.
  if (m.plan) return null;

  const imageGrid = realImages.length > 0 && (
    <div className="flex flex-wrap gap-2">
      {realImages.map((img, i) => {
        // Persistent positional label (Image A, B, …) shown so the user can
        // reference a specific image to the model; the label text is kept in
        // English to match the manifest the model receives (see imageLabels).
        const label = `Image ${imageLabel((imageLabelStart ?? 0) + i)}`;
        return (
          <button
            key={i}
            type="button"
            onClick={() => openLightbox(img)}
            aria-label={`${t("chat.viewImage")} — ${label}`}
            title={`${label} · ${t("chat.viewImage")}`}
            className="focus-visible:ring-ring relative cursor-zoom-in overflow-hidden rounded-md focus-visible:ring-2 focus-visible:outline-none"
          >
            <img
              src={imageDataUrl(img)}
              alt={label}
              className="max-h-48 rounded-md"
            />
            <span className="bg-background/80 text-foreground absolute top-1 left-1 rounded px-1.5 py-0.5 text-[10px] font-semibold backdrop-blur-sm">
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
  const videoGallery = videoOptions.length > 0 && activeVideoId && (
    <YouTubeEmbed options={videoOptions} initialId={activeVideoId} />
  );
  const images = (imageGrid || videoGallery) && (
    <div className="flex flex-col gap-2">
      {imageGrid}
      {videoGallery}
    </div>
  );
  // Document attachments (T39) — rendered alongside images, so they appear in
  // every chat style (each style branch below includes {docs}). No click
  // action in v1: the stored payload is the *extracted text* (which already
  // travels inside the message context), not the original file, so there's
  // nothing meaningful to open or download yet.
  const docs = m.documents.length > 0 && (
    <div className="flex flex-wrap gap-2">
      {m.documents.map((d, i) => (
        <div
          key={i}
          title={d.name}
          className="bg-muted/40 text-muted-foreground flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
        >
          <FileText className="size-3.5 shrink-0" aria-hidden />
          <span className="text-foreground/90 truncate">{d.name}</span>
          <span className="shrink-0">
            {t("document.chars", { n: d.text.length.toLocaleString() })}
          </span>
        </div>
      ))}
    </div>
  );
  const reasoning = m.role === "assistant" && m.reasoning && (
    <ReasoningPanel reasoning={m.reasoning} />
  );
  const apiTrace = m.role === "assistant" &&
    m.apiTrace &&
    m.apiTrace.length > 0 && <ApiTracePanel trace={m.apiTrace} />;
  const tools = m.role === "assistant" && m.toolCalls.length > 0 && (
    <div className="flex flex-col items-start gap-1">
      {m.toolCalls.map((tc, i) => (
        <ToolActivity key={tc.id ?? i} call={tc} />
      ))}
    </div>
  );
  // Research subagents (deep research, T55): a labeled stack of subagent cards.
  const subagents = m.role === "assistant" && m.subagents.length > 0 && (
    <div className="flex w-full max-w-prose flex-col items-stretch gap-1">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Telescope className="size-3 shrink-0" aria-hidden />
        <span>{t("chat.subagentsTitle")}</span>
      </div>
      {m.subagents.map((s, i) => (
        <SubagentCard key={s.id || i} sub={s} />
      ))}
    </div>
  );
  const realMessageId = m.id === STREAM_ID ? null : m.id;
  const body =
    m.content &&
    (m.role === "assistant" ? (
      wholeArtifact ? (
        <ArtifactContext.Provider
          value={{
            messageId: realMessageId,
            threadId: realMessageId ? m.thread_id : null,
            ordinalFor: () => 0,
          }}
        >
          <ArtifactCard code={m.content} />
        </ArtifactContext.Provider>
      ) : (
        // Assistant text is Markdown (GFM + highlighted code fences).
        // react-markdown tolerates partial/unclosed Markdown, so this
        // is safe to render against the growing streaming placeholder.
        <div ref={bodyRef} className="contents">
          <Markdown
            content={m.content}
            suppressedVideoIds={suppressedVideoIds}
            // Real ids only: a streaming placeholder stays ephemeral so artifacts
            // persist exactly once, when the reply is saved.
            messageId={realMessageId}
            threadId={realMessageId ? m.thread_id : null}
            // Live streaming placeholder → defer flicker-prone renderers (Mermaid)
            // until the reply completes.
            streaming={m.id === STREAM_ID}
          />
        </div>
      )
    ) : (
      <span className="whitespace-pre-wrap">{m.content}</span>
    ));
  // Planner plan panel: shown above the message body when a plan exists.
  const planPanel =
    m.role === "assistant" && m.plan ? <PlanPanel plan={m.plan} /> : null;
  // Model attribution: collapsible detail showing which model generated this
  // message (useful for planner/worker-step attribution).
  const attribution =
    m.role === "assistant" && m.provider ? (
      <ModelBadge
        provider={m.provider}
        model={m.model ?? ""}
        role={m.plan ? undefined : undefined}
      />
    ) : null;
  // Variation controls (T54) — only on the latest reply, only when grouped.
  // They ride in the meta row (next to copy), so they render inside AssistantMeta.
  const variations =
    m.role === "assistant" && latestReply && m.variantIds ? (
      <VariationControls m={m} />
    ) : null;
  // Request sources button (T56) — all persisted (non-streaming) assistant replies.
  const requestSourcesBtn =
    m.role === "assistant" && realMessageId ? (
      <RequestSourcesButton messageId={realMessageId} />
    ) : null;
  const speakBtn =
    m.role === "assistant" && realMessageId && m.content ? (
      <SpeakButton content={m.content} bodyRef={bodyRef} />
    ) : null;
  const meta = m.role === "assistant" && (
    <AssistantMeta
      createdAt={m.created_at}
      durationMs={m.duration_ms}
      content={m.content}
      speak={speakBtn}
      trailing={
        variations || requestSourcesBtn ? (
          <>
            {variations}
            {requestSourcesBtn}
          </>
        ) : undefined
      }
      wide={wide}
      onToggleWide={onToggleWide}
    />
  );
  const flashRing = flashed && "ring-primary rounded-lg ring-2 ring-offset-2";
  // Small avatar + name byline above a bot's reply, for the styles without
  // their own name/gutter treatment (default, bubbles, document, cards, zebra).
  const byline = asBot && (
    <span
      className={cn(
        "flex items-center gap-1.5 text-xs font-semibold",
        injected ? "text-primary" : "text-muted-foreground",
      )}
    >
      <BotAvatar bot={asBot} className="size-5" />
      {botName}
    </span>
  );

  if (chatStyle === "compact") {
    // Dense IRC-like row: a fixed-width role gutter, then the text. Markdown
    // margins are tightened by the `.chat-style-compact` rules in index.css.
    return (
      <div
        ref={containerRef}
        data-mid={m.id}
        className={cn("mx-auto flex w-full scroll-mt-4", isUser && "mb-5")}
        style={{ maxWidth }}
      >
        <div
          className={cn(
            // chat-content: hook for the custom chat font/size overrides
            // (T33, src/lib/appearance.ts) — no styling unless customized.
            "chat-content flex w-full max-w-full gap-2 text-sm",
            flashRing,
          )}
        >
          <span
            className={cn(
              "w-10 shrink-0 text-right text-xs leading-5 font-semibold select-none",
              isUser ? "text-primary" : "text-muted-foreground",
            )}
            title={asBot ? asBot.name : undefined}
            aria-hidden
          >
            {asBot ? (
              <BotAvatar
                bot={asBot}
                className={cn(
                  "ml-auto size-5",
                  // Injected one-shot reply (T43): accent ring on the gutter
                  // avatar (this style has no name to prefix).
                  injected && "ring-primary ring-1",
                )}
              />
            ) : isUser ? (
              t("chat.you")
            ) : (
              t("chat.ai")
            )}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {images}
            {docs}
            {reasoning}
            {tools}
            {subagents}
            {apiTrace}
            {planPanel}
            {body}
            {attribution}
            {meta}
          </div>
        </div>
      </div>
    );
  }

  if (chatStyle === "cozy") {
    // Slack/Discord-style: a round avatar monogram and a bold role name above
    // each message, everything left-aligned.
    return (
      <div
        ref={containerRef}
        data-mid={m.id}
        className={cn(
          "mx-auto flex w-full scroll-mt-4 gap-2.5",
          isUser && "mb-5",
        )}
        style={{ maxWidth }}
      >
        {asBot ? (
          <BotAvatar bot={asBot} className="size-7 shrink-0" />
        ) : (
          <span
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-bold uppercase select-none",
              isUser
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground",
            )}
            aria-hidden
          >
            {(isUser ? t("chat.you") : t("chat.ai")).slice(0, 1)}
          </span>
        )}
        <div
          className={cn(
            "chat-content flex min-w-0 flex-1 flex-col gap-1 text-sm",
            flashRing,
          )}
        >
          <span
            className={cn(
              "text-xs leading-7 font-semibold",
              !asBot && "capitalize",
              isUser || injected ? "text-primary" : "text-muted-foreground",
            )}
            aria-hidden
          >
            {asBot ? botName : isUser ? t("chat.you") : t("chat.ai")}
          </span>
          {images}
          {docs}
          {reasoning}
          {tools}
          {subagents}
          {apiTrace}
          {planPanel}
          {body}
          {attribution}
          {meta}
        </div>
      </div>
    );
  }

  if (chatStyle === "terminal") {
    // CLI-session look: everything monospace; user messages read as typed
    // commands (a ❯ prompt, accent-colored text), assistant replies as plain
    // output. Markdown rhythm is tightened by the same index.css rules as
    // compact.
    return (
      <div
        ref={containerRef}
        data-mid={m.id}
        className={cn("mx-auto flex w-full scroll-mt-4", isUser && "mb-5")}
        style={{ maxWidth }}
      >
        <div
          className={cn(
            "chat-content flex w-full max-w-full gap-2 font-mono text-sm",
            isUser && "text-primary",
            flashRing,
          )}
        >
          {isUser && (
            <span className="shrink-0 font-bold select-none" aria-hidden>
              ❯
            </span>
          )}
          {/* Bot persona (T38): a dim name marker before the output, where
              the ❯ prompt sits for user lines. */}
          {asBot && (
            <span
              className={cn(
                "shrink-0 font-bold select-none",
                injected ? "text-primary" : "text-muted-foreground",
              )}
              aria-hidden
            >
              {botName}
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {images}
            {docs}
            {reasoning}
            {tools}
            {subagents}
            {apiTrace}
            {planPanel}
            {body}
            {attribution}
            {meta}
          </div>
        </div>
      </div>
    );
  }

  const { row, content } = styleClasses(chatStyle, isUser);
  return (
    <div
      ref={containerRef}
      data-mid={m.id}
      className={cn("mx-auto flex w-full scroll-mt-4", row, isUser && "mb-5")}
      style={{ maxWidth }}
    >
      <div
        className={cn(
          // chat-content: hook for the custom chat font/size overrides
          // (T33, src/lib/appearance.ts) — no styling unless customized.
          // min-w-0: WebKit's default `min-width:auto` on flex items lets long
          // unbreakable content (URLs) refuse to shrink and overflow the row —
          // the compact/cozy paths already carry it; the default path didn't.
          "chat-content flex min-w-0 flex-col gap-2",
          content,
          flashRing,
        )}
      >
        {byline}
        {images}
        {docs}
        {reasoning}
        {tools}
        {subagents}
        {apiTrace}
        {planPanel}
        {body}
        {attribution}
        {meta}
      </div>
    </div>
  );
});

/** Drives re-render of relative timestamps so "2m ago" advances on its own.
 *  Separate from the message-list state so only AssistantMeta re-renders on
 *  the tick, not the entire message list every 30 seconds. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function MessageList({
  messages,
  pending,
  busy,
  bot,
  topInset,
}: MessageListProps) {
  const t = useT();
  // Persona roster for @-mention attribution (T43): a message with `bot_id`
  // set renders that persona's avatar + name regardless of the thread's bot.
  const bots = useBots((s) => s.bots);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const scrollToMessageId = useSearch((s) => s.scrollToMessageId);
  const consumeScroll = useSearch((s) => s.consumeScroll);
  // How messages render (T34): default / bubbles / compact / document.
  const chatStyle = useAppearance((s) => s.chatStyle);
  const chatMaxWidth = useAppearance((s) => s.chatMaxWidth);
  const animations = useAppearance((s) => s.animations);
  // Session-only set of reply ids expanded to full width. Not persisted —
  // resets on restart, mirroring other per-session chat UI state.
  const [wideIds, setWideIds] = useState<Set<string>>(() => new Set());
  const toggleWide = useCallback((id: string) => {
    setWideIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  // The cap (and the per-reply toggle) only apply when a max-width is set;
  // null = full width everywhere.
  const capped = chatMaxWidth != null;
  // Message briefly highlighted after jumping to it from a search result.
  const [flashId, setFlashId] = useState<string | null>(null);
  // Live streaming bubble state (throttled, moved out of messages[] for perf).
  const streamingContent = useThreads((s) => s.streamingContent);
  const streamingToolCalls = useThreads((s) => s.streamingToolCalls);
  const streamingSubagents = useThreads((s) => s.streamingSubagents);
  const streamingImages = useThreads((s) => s.streamingImages);
  const streamingBotId = useThreads((s) => s.streamingBotId);
  const streamingProvider = useThreads((s) => s.streamingProvider);
  const streamingModel = useThreads((s) => s.streamingModel);
  // Augment messages with a live streaming bubble when one is active.
  const displayItems = useMemo(() => {
    if (streamingContent === null) return messages;
    return [
      ...messages,
      {
        id: STREAM_ID,
        thread_id: messages[0]?.thread_id ?? "",
        role: "assistant" as const,
        content: streamingContent,
        kind: "normal" as const,
        duration_ms: null,
        bot_id: streamingBotId,
        variant_group: null,
        variant_selected: 1,
        created_at: "",
        provider: streamingProvider,
        model: streamingModel,
        images: streamingImages,
        documents: [],
        toolCalls: streamingToolCalls,
        subagents: streamingSubagents,
      } as MessageView,
    ];
  }, [
    messages,
    streamingContent,
    streamingToolCalls,
    streamingSubagents,
    streamingImages,
    streamingBotId,
    streamingProvider,
    streamingModel,
  ]);

  // T57 — rotating loading messages. The interval fires every 2.2 s while
  // `pending` is true, bumping a counter that selects the next phrase.
  // setState is only called from the timer callback (not synchronously in the
  // effect body), so the react-hooks/set-state-in-effect rule is satisfied.
  const [loadingTick, setLoadingTick] = useState(0);
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => setLoadingTick((n) => n + 1), 2200);
    return () => clearInterval(id);
  }, [pending]);
  const loadingKey = pickLoadingMessage(
    loadingTick,
    LOADING_MESSAGE_KEYS,
  ) as MessageKey;

  // When a search-result / chat-panel jump targets a message, scroll to +
  // flash it via Virtuoso's scrollToIndex.
  useEffect(() => {
    if (scrollToMessageId) {
      const idx = messages.findIndex((m) => m.id === scrollToMessageId);
      if (idx !== -1) {
        virtuosoRef.current?.scrollToIndex({
          index: idx,
          align: "center",
          behavior: "smooth",
        });
        // eslint-disable-next-line react-hooks/set-state-in-effect -- flash is a direct side-effect of the scroll target arriving
        setFlashId(scrollToMessageId);
        const t = setTimeout(() => setFlashId(null), 2000);
        consumeScroll();
        return () => clearTimeout(t);
      }
      consumeScroll();
    }
  }, [scrollToMessageId, messages, consumeScroll]);

  // Auto-scroll to bottom on thread switch / initial load.
  const prevMessagesRef = useRef(messages);
  useEffect(() => {
    if (prevMessagesRef.current !== messages && messages.length > 0) {
      prevMessagesRef.current = messages;
      virtuosoRef.current?.scrollToIndex({ index: "LAST", behavior: "auto" });
    }
  }, [messages]);

  // Follow the reply as it streams. Virtuoso's `followOutput` re-pins on item
  // *count* changes, but here the last item (the streaming placeholder) grows
  // in place on every ~100ms flush — so we re-pin on each streamingContent
  // change while the user is still parked at the bottom. `atBottomThreshold`
  // gives hysteresis so a single flush's growth doesn't read as "scrolled up";
  // scrolling up past it opts out of the follow until they return to the bottom.
  const atBottomRef = useRef(true);
  useEffect(() => {
    if (busy && streamingContent !== null && atBottomRef.current) {
      virtuosoRef.current?.scrollToIndex({
        index: "LAST",
        align: "end",
        behavior: "auto",
      });
    }
  }, [streamingContent, busy]);

  // The thread's most recent assistant reply gets the variation controls (T54).
  // Includes the streaming placeholder (no variantIds → renders nothing), which
  // correctly suppresses controls on the prior reply while a reply is in flight.
  let lastAssistantIndex = -1;
  for (let k = 0; k < displayItems.length; k++) {
    if (
      displayItems[k].role === "assistant" &&
      displayItems[k].kind === "normal"
    )
      lastAssistantIndex = k;
  }

  // Per-message label offsets (Image A/B… and Video A/B… by order of
  // appearance), matching the labels injected into the API history so a user
  // reference like "Image B" / "Video B" lines up with what the model was told.
  // Videos (YouTube search results) are a separate sequence when the plugin is
  // on (see partitionVideoThumbs); off → everything counts as images.
  const ytEnabled = usePlugins((s) =>
    hasRenderer(selectRegistry(s), "youtube"),
  );
  const { imageOffsets, videoOffsets } = mediaLabelOffsets(
    displayItems,
    ytEnabled,
  );

  // Stable lookup map for mention-bot resolution (avoids .find() per message
  // which would defeat React.memo by returning new object references).
  const botsById = useMemo(() => {
    const m = new Map<string, Bot>();
    for (const b of bots) m.set(b.id, b);
    return m;
  }, [bots]);

  // Stable onToggleWide callbacks per message so React.memo on ChatMessage works.
  const [toggleWideCallbacks] = useState(() => new Map<string, () => void>());
  const getToggleWide = (id: string): (() => void) | undefined => {
    if (!capped) return undefined;
    let cb = toggleWideCallbacks.get(id);
    if (!cb) {
      cb = () => toggleWide(id);
      toggleWideCallbacks.set(id, cb);
    }
    return cb;
  };

  if (displayItems.length === 0 && !pending) {
    // Empty chat: a persona greets with its own starters (T38); a plain new
    // chat shows configurable quick actions + persona starters.
    return <EmptySuggestions bot={bot} />;
  }

  return (
    <Virtuoso
      ref={virtuosoRef}
      className="flex min-w-0 flex-1 flex-col"
      data={displayItems}
      computeItemKey={(_, m) => m.id}
      // ponytail: "auto" (instant stick-to-bottom), not "smooth" — a smooth
      // scroll tween was being launched on every ~100ms stream flush and
      // stacking up on WebKitGTK. Upgrade path: one rAF-debounced smooth
      // scroll if instant reads too jumpy.
      followOutput={busy ? "auto" : false}
      atBottomThreshold={120}
      atBottomStateChange={(atBottom) => {
        atBottomRef.current = atBottom;
      }}
      itemContent={(idx, m) => {
        if (m.kind === "summary") {
          return (
            <div
              ref={(el: HTMLDivElement | null) => {
                if (el) messageRefs.current.set(m.id, el);
                else messageRefs.current.delete(m.id);
              }}
              className={cn(
                "mx-auto w-full scroll-mt-4",
                flashId === m.id &&
                  "ring-primary rounded-lg ring-2 ring-offset-2",
              )}
              style={{ maxWidth: chatMaxWidth ?? undefined }}
            >
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <div className="bg-border h-px flex-1" />
                <FoldVertical className="size-3 shrink-0" aria-hidden />
                <details className="min-w-0">
                  <summary className="cursor-pointer select-none">
                    {t("chat.compacted")}
                  </summary>
                  <div className="bg-muted/40 text-foreground/90 mt-2 rounded-md border p-3 text-sm">
                    <Markdown content={m.content} />
                  </div>
                </details>
                <div className="bg-border h-px flex-1" />
              </div>
            </div>
          );
        }
        return (
          <ChatMessage
            m={m}
            chatStyle={chatStyle}
            flashed={flashId === m.id}
            messageRefs={messageRefs}
            bot={bot}
            latestReply={idx === lastAssistantIndex}
            imageLabelStart={imageOffsets[idx]}
            videoLabelStart={videoOffsets[idx]}
            mentionBot={m.bot_id ? (botsById.get(m.bot_id) ?? null) : null}
            maxWidth={capped && !wideIds.has(m.id) ? chatMaxWidth : undefined}
            wide={wideIds.has(m.id)}
            onToggleWide={getToggleWide(m.id)}
          />
        );
      }}
      components={{
        Scroller: forwardRef<
          HTMLDivElement,
          React.HTMLAttributes<HTMLDivElement>
        >(function Scroller(props, ref) {
          // Soft top-edge fade so messages dissolve as they scroll out the top
          // instead of a hard clip — fixes the "ugly cutoff", independent of the
          // topbar (which only covers the top while it's shown).
          const topFade = "linear-gradient(to bottom, transparent, #000 40px)";
          return (
            <div
              {...props}
              ref={ref}
              data-chat-scroll
              style={{
                ...props.style,
                maskImage: topFade,
                WebkitMaskImage: topFade,
              }}
              className={cn(
                props.className,
                "overflow-x-hidden",
                // Thin, space-taking scrollbar (styled in index.css under
                // `[data-chat-scroll]`) — the native overlay scrollbar floated
                // over and clipped the text, and `scrollbar-gutter: stable`
                // can't reserve space for an overlay scrollbar. The styled bar
                // takes layout width, so content insets instead of hiding.
                `chat-style-${chatStyle}`,
                CHAT_CONTAINER_CLASSES[chatStyle],
              )}
            />
          );
        }),
        Header: topInset
          ? () => <div aria-hidden style={{ height: topInset }} />
          : undefined,
        Footer: () => {
          if (!pending) return null;
          return (
            <div
              className="mx-auto flex w-full justify-start"
              style={{ maxWidth: chatMaxWidth ?? undefined }}
            >
              <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
                <span
                  key={animations ? loadingKey : undefined}
                  className={animations ? "snak-loading-message" : undefined}
                >
                  {t(loadingKey)}
                </span>
                {animations ? (
                  <span
                    aria-hidden
                    className="bg-muted-foreground/30 inline-block h-3 w-8 animate-pulse rounded-full"
                  />
                ) : (
                  <span aria-hidden className="flex gap-0.5">
                    {[0, 0.2, 0.4].map((_delay, i) => (
                      <span
                        key={i}
                        className="bg-muted-foreground inline-block size-1 rounded-full opacity-30"
                      />
                    ))}
                  </span>
                )}
              </div>
            </div>
          );
        },
      }}
    />
  );
}
