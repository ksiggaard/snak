import { useEffect, useDeferredValue, useMemo, useRef, useState } from "react";
import {
  Camera,
  FileText,
  FoldVertical,
  Loader2,
  Maximize2,
  Mic,
  Paperclip,
  SendHorizontal,
  Square,
  Telescope,
  TerminalSquare,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Canvas } from "@/components/chat/Canvas";
import { ImageChip } from "@/components/chat/ImageChip";
import { ContextMeter } from "@/components/chat/ContextMeter";
import { ModelPicker } from "@/components/chat/ModelPicker";
import { WorkspaceFileSelector } from "@/components/chat/WorkspaceFileSelector";
import { canCompact } from "@/lib/compaction";
import {
  classifyFile,
  DOCUMENT_CHAR_BUDGET,
  documentMediaType,
  extractDocumentText,
  fileExtension,
  MAX_DOCUMENT_BYTES,
  truncateDocumentText,
  type PendingDocument,
} from "@/lib/documents";
import { prepareImage, type PreparedImage } from "@/lib/image";
import {
  activeMentionQuery,
  insertMention,
  matchMentionBots,
} from "@/lib/mentions";
import { isKeylessProvider, useProviders } from "@/lib/providers";
import { takeScreenshot } from "@/lib/quick";
import { openInTerminal } from "@/lib/terminal";
import {
  availableCommands,
  matchCommands,
  parseSlashInput,
  resolveCommand,
  type SlashCommand,
} from "@/lib/slashCommands";
import { SoundWave } from "@/components/chat/SoundWave";
import { AudioRecorder } from "@/lib/audioRecorder";
import { sttTranscribe } from "@/lib/audio";
import { audioEnabled } from "@/lib/plugins";
import { useAudio } from "@/store/audio";
import { BotAvatar } from "@/components/bots/BotAvatar";
import { useBots } from "@/store/bots";
import { selectRegistry, usePlugins } from "@/store/plugins";
import { useThreads } from "@/store/threads";
import { useKeys } from "@/store/keys";
import { useModels } from "@/store/models";
import { useOllama } from "@/store/ollama";
import { useConnectivity, useIsOffline } from "@/store/connectivity";
import { t as tNow, useT } from "@/store/i18n";
import type { Bot, Provider } from "@/types/db";

interface ComposerProps {
  onSend: (
    text: string,
    images: PreparedImage[],
    documents: PendingDocument[],
  ) => void;
  /** Cancel the in-flight stream (shown as a Stop button while busy). */
  onCancel: () => void;
  /** Streaming is in progress: show Stop instead of Send. */
  busy?: boolean;
  /** Currently selected provider — Send is gated on it having a stored key. */
  provider: Provider;
  /** Model in effect for this thread/draft — keys the context-size readout (T53). */
  model: string;
  /** Whether the selected provider is currently enabled (T18). */
  providerEnabled: boolean;
  /** Whether any provider is enabled at all (false = all-disabled state). */
  anyProvider: boolean;
}

export function Composer({
  onSend,
  onCancel,
  busy,
  provider,
  model,
  providerEnabled,
  anyProvider,
}: ComposerProps) {
  const t = useT();
  const providers = useProviders();
  const providerLabel = (id: Provider) =>
    providers.find((p) => p.id === id)?.label ?? id;
  const [text, setText] = useState("");
  const [images, setImages] = useState<PreparedImage[]>([]);
  // Documents staged for the next send (T39): extracted text + metadata.
  const [documents, setDocuments] = useState<PendingDocument[]>([]);
  // A binary document is being text-extracted in the backend (spinner chip).
  const [extracting, setExtracting] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [shooting, setShooting] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Prompt history recall (shell-style) -----------------------------------
  // `historyIndex` is the position in `userHistory` (0 = most recent) while
  // "arrow mode" is active; null means inactive. Up from an empty field starts
  // it; Up/Down walk the list; Right accepts; Esc cancels back to empty.
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);

  // --- Slash commands (T14) --------------------------------------------------
  // Built-in commands + the enabled plugin `slash-command` contributions, read
  // off the T12 host registry (the single seam — never plugin internals).
  const slashContributions = usePlugins((s) => selectRegistry(s).slashCommands);
  const commands = useMemo(
    () => availableCommands(slashContributions),
    [slashContributions],
  );
  // Feeds slash-command output into the conversation without an LLM round-trip.
  const postNote = useThreads((s) => s.postNote);
  // Quick-action prefill (T-quick): a pending request to load text into the
  // field, posted by the empty-screen suggestions. Applied via render-time sync
  // below (keyed by nonce).
  const composerInsert = useThreads((s) => s.composerInsert);
  // A request to focus this input (Cmd/Ctrl+L), no text change.
  const composerFocus = useThreads((s) => s.composerFocus);

  // A command pending the user's explicit confirmation before it runs (the
  // safety gate for backend actions like /terminal — never auto-executed).
  const [pendingCommand, setPendingCommand] = useState<{
    command: SlashCommand;
    args: string;
  } | null>(null);

  // The palette is shown while the input is being typed as a slash command and
  // hasn't been dismissed. We highlight one entry for keyboard selection.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteIndex, setPaletteIndex] = useState(0);

  // The first whitespace-delimited token, used to filter the palette as the
  // user types `/te…`. Once a space follows the command word the palette
  // collapses (the user has moved on to typing args).
  const isSlashPrefix = text.startsWith("/") && !text.startsWith("//");
  const firstToken = text.split(/\s/, 1)[0];
  const hasArgsYet = /\s/.test(text);
  const matches = isSlashPrefix ? matchCommands(firstToken, commands) : [];
  const showPalette =
    paletteOpen && isSlashPrefix && !hasArgsYet && matches.length > 0;

  // --- @-mentions (T43) -------------------------------------------------------
  // Typing `@` (at the start or after whitespace) opens a persona palette
  // anchored to the token under the caret — unlike the leading-`/` rule,
  // mentions can appear mid-text, so the caret position is tracked too.
  const bots = useBots((s) => s.bots);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionQuery = activeMentionQuery(text, caret);
  const mentionMatches = mentionQuery
    ? matchMentionBots(mentionQuery.query, bots)
    : [];
  // The slash palette wins the degenerate overlap (a leading "/" command word
  // can't contain "@", so this only matters for malformed input).
  const showMentionPalette =
    mentionOpen && !showPalette && mentionMatches.length > 0;

  // --- Voice dictation (audio plugin STT) ------------------------------------
  const audioOn = usePlugins((s) => audioEnabled(selectRegistry(s)));
  const sttModel = useAudio((s) => s.sttModel);
  const [recState, setRecState] = useState<
    "idle" | "recording" | "transcribing"
  >("idle");
  const [recAnalyser, setRecAnalyser] = useState<AnalyserNode | null>(null);
  const [recError, setRecError] = useState<string | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);

  /** Append transcribed text into the field for review (never auto-sends), with
   * the caret left at the end — mirrors `pickMention`'s insertion pattern. */
  function insertTranscript(transcript: string) {
    const clean = transcript.trim();
    if (!clean) return;
    setHistoryIndex(null);
    setText((prev) => {
      const next = prev && !/\s$/.test(prev) ? `${prev} ${clean}` : prev + clean;
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(next.length, next.length);
          setCaret(next.length);
        }
      });
      return next;
    });
  }

  async function startRecording() {
    setRecError(null);
    const recorder = new AudioRecorder();
    try {
      await recorder.start();
    } catch (e) {
      setRecError(e instanceof Error ? e.message : String(e));
      return;
    }
    recorderRef.current = recorder;
    setRecAnalyser(recorder.analyser);
    setRecState("recording");
  }

  async function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    setRecState("transcribing");
    setRecAnalyser(null);
    try {
      const wav = await recorder.stop();
      const transcript = await sttTranscribe(
        Array.from(wav),
        sttModel,
        "auto",
      );
      insertTranscript(transcript);
    } catch (e) {
      setRecError(e instanceof Error ? e.message : String(e));
    } finally {
      recorderRef.current = null;
      setRecState("idle");
    }
  }

  function cancelRecording() {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setRecAnalyser(null);
    setRecState("idle");
  }

  // Tear down a live recording if the composer unmounts mid-capture.
  useEffect(
    () => () => {
      recorderRef.current?.cancel();
    },
    [],
  );

  /** Insert the picked persona as `@Name ` over the typed token. The trailing
   * space ends the active mention token, so the palette closes and the next
   * Enter sends (no double-capture). */
  function pickMention(bot: Bot) {
    if (!mentionQuery) return;
    const r = insertMention(text, mentionQuery, bot.name);
    setText(r.text);
    setCaret(r.caret);
    setMentionOpen(false);
    // React re-renders the textarea with the caret at the end; put it back
    // right after the inserted mention.
    requestAnimationFrame(() => {
      textareaRef.current?.setSelectionRange(r.caret, r.caret);
    });
  }

  // Quick-action prefill: when the store posts a new insert (nonce changed),
  // drop its text into the field. Render-time setState — not a useEffect
  // (forbidden by react-hooks/set-state-in-effect) — matching the repo's
  // store→local pattern (see ModelPicker). `appliedNonce` is state (not a ref)
  // so accessing it during render is allowed; the same text inserted twice
  // still applies because each insert bumps the nonce.
  const [appliedNonce, setAppliedNonce] = useState(0);
  if (composerInsert && composerInsert.nonce !== appliedNonce) {
    setAppliedNonce(composerInsert.nonce);
    setText(composerInsert.text);
    setHistoryIndex(null);
  }
  // Focus + caret-to-end after a prefill lands. A side-effect (no setState), so
  // it's fine in an effect; keyed on the applied nonce so it runs once per
  // insert, after the text has been committed.
  useEffect(() => {
    if (appliedNonce === 0) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [appliedNonce]);

  // Focus the input on an external focus request (Cmd/Ctrl+L), without
  // touching the text. The ref is seeded with the current nonce, so mounting —
  // or returning to chat from another view — never steals focus; only a *new*
  // request (a nonce change after mount) does. So if no Composer is mounted
  // when the shortcut fires, it's simply a no-op (behavior B).
  const lastFocusNonce = useRef(composerFocus?.nonce ?? 0);
  useEffect(() => {
    const nonce = composerFocus?.nonce ?? 0;
    if (nonce === lastFocusNonce.current) return;
    lastFocusNonce.current = nonce;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [composerFocus]);

  // Whether the selected provider has a stored API key — from the cached keys
  // store (no keychain prompt). `null` while the cache is still loading, which
  // matches the previous "checking" state so Send isn't blocked before we know.
  const keyPresent = useKeys((s) => s.present);
  const keysLoaded = useKeys((s) => s.loaded);
  // A keyless provider (local Ollama, T37) has no key to check — readiness is
  // the daemon's reachability instead: ok → ready, unknown → still checking
  // (same as the keys cache loading), down → blocked with a retry notice.
  const ollamaStatus = useOllama((s) => s.status);
  const refreshOllama = useOllama((s) => s.refresh);
  const keyless = isKeylessProvider(provider);

  // Offline mode (effective = no internet OR manual "Work offline"). A cloud
  // provider can't be reached, so we block the send and offer a one-click
  // switch to the keyless local provider (Ollama). The user's selection is
  // never changed automatically — only on pressing "Use local model".
  const offline = useIsOffline();
  const refreshConnectivity = useConnectivity((s) => s.refresh);
  const setProviderModel = useThreads((s) => s.setProviderModel);
  const allModels = useModels((s) => s.models);
  const cloudBlockedOffline = providerEnabled && offline && !keyless;
  function switchToLocal() {
    // Prefer an actually-installed local model; fall back to the provider's
    // default (the user can pull it from Ollama settings if missing).
    const local = allModels.find((m) => m.provider === "ollama")?.model_id;
    const fallback = providers.find((p) => p.id === "ollama")?.defaultModel;
    const target = local ?? fallback;
    if (target) void setProviderModel("ollama", target);
  }
  const keyReady = keyless
    ? ollamaStatus === "unknown"
      ? null
      : ollamaStatus === "ok"
    : keysLoaded
      ? keyPresent.has(provider)
      : null;

  // --- Compaction (T28) -------------------------------------------------------
  // Enabled only for a saved thread with at least one exchange since the last
  // compaction point and nothing in flight; shows a spinner while summarizing.
  const compact = useThreads((s) => s.compact);
  const compacting = useThreads((s) => s.compacting);
  const currentThreadId = useThreads((s) => s.currentThreadId);
  const threadMessages = useDeferredValue(useThreads((s) => s.messages));
  const compactEnabled =
    currentThreadId !== null &&
    !busy &&
    !compacting &&
    providerEnabled &&
    keyReady !== false &&
    canCompact(threadMessages);

  // --- Deep research (T55) ----------------------------------------------------
  // A per-thread (or draft) toggle: when on, the model may dispatch parallel
  // research subagents. The effective value lives on the saved thread row, or on
  // the draft for an unsaved chat.
  const setDeepResearch = useThreads((s) => s.setDeepResearch);
  const deepResearchOn = useThreads((s) =>
    s.currentThreadId
      ? (s.threads.find((x) => x.id === s.currentThreadId)?.deep_research ??
          0) !== 0
      : s.draftDeepResearch,
  );

  // Previously-sent user prompts in this thread, most-recent first — the source
  // for arrow-key history recall. Summary rows aren't real prompts.
  const userHistory = useMemo(
    () =>
      threadMessages
        .filter((m) => m.role === "user" && m.kind !== "summary")
        .map((m) => m.content)
        .reverse(),
    [threadMessages],
  );

  /** Put the caret at the end of the textarea after React re-renders. */
  function caretToEnd() {
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  /** Show history entry `idx` as the current draft (arrow mode on). */
  function showHistory(idx: number) {
    const value = userHistory[idx];
    setHistoryIndex(idx);
    setText(value);
    setCaret(value.length);
    // A programmatic fill must not arm the slash/mention palettes.
    setPaletteOpen(false);
    setMentionOpen(false);
    caretToEnd();
  }

  /** Leave arrow mode. `clear` empties the field (Esc / past-newest Down);
   * otherwise the recalled text stays as an editable draft (Right accepts). */
  function exitHistory(clear: boolean) {
    setHistoryIndex(null);
    if (clear) {
      setText("");
      setCaret(0);
    } else {
      caretToEnd();
    }
  }

  /** Extract files from a DataTransfer, trying .files first, then .items
   *  (needed on Linux where browser/clipboard drags use items instead). */
  function filesFromDataTransfer(dt: DataTransfer): File[] {
    if (dt.files.length > 0) return Array.from(dt.files);
    const result: File[] = [];
    for (const item of dt.items) {
      if (item.kind === "file") {
        const blob = item.getAsFile();
        if (blob) result.push(new File([blob], blob.name || "file", { type: blob.type }));
      }
    }
    return result;
  }

  /**
   * Route picked/dropped/pasted files by `classifyFile` (T39): images keep the
   * existing pipeline; text files are read in the webview; binary documents go
   * through the Rust extractor. Legacy Office / unsupported files surface an
   * inline notice — a file is NEVER silently dropped.
   */
  async function addFiles(files: Iterable<File>) {
    setAttachError(null);
    for (const file of Array.from(files)) {
      const cls = classifyFile(file.name, file.type);
      if (cls === "image") {
        try {
          const prepared = await prepareImage(file);
          setImages((prev) => [...prev, prepared]);
        } catch {
          setAttachError(tNow("composer.imageError"));
        }
        continue;
      }
      if (cls === "legacy-document") {
        setAttachError(tNow("composer.documentLegacy", { name: file.name }));
        continue;
      }
      if (cls === "unsupported") {
        setAttachError(
          tNow("composer.documentUnsupported", { name: file.name }),
        );
        continue;
      }
      // text | binary-document — both end up as extracted text.
      if (file.size > MAX_DOCUMENT_BYTES) {
        setAttachError(
          tNow("composer.documentTooLarge", {
            name: file.name,
            max: `${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB`,
          }),
        );
        continue;
      }
      try {
        let raw: string;
        if (cls === "text") {
          raw = await file.text();
        } else {
          setExtracting(true);
          try {
            raw = await extractDocumentText(file);
          } finally {
            setExtracting(false);
          }
        }
        const { text: docText, truncated } = truncateDocumentText(raw);
        setDocuments((prev) => [
          ...prev,
          {
            name: file.name,
            mediaType: documentMediaType(file.name, file.type),
            text: docText,
            truncated,
          },
        ]);
        if (truncated) {
          setAttachError(
            tNow("composer.documentTruncated", {
              name: file.name,
              n: DOCUMENT_CHAR_BUDGET.toLocaleString(),
            }),
          );
        }
      } catch (err) {
        // The extractor rejects with a user-readable string per its contract.
        setAttachError(
          tNow("composer.documentReadError", {
            name: file.name,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  function replaceImage(index: number, prepared: PreparedImage) {
    setImages((prev) => prev.map((img, i) => (i === index ? prepared : img)));
  }

  function removeDocument(index: number) {
    setDocuments((prev) => prev.filter((_, i) => i !== index));
  }

  /** Interactive region screenshot (same path as the quick overlay): the
   * main window hides during capture, the PNG attaches to the draft. */
  async function screenshot() {
    setShooting(true);
    setAttachError(null);
    try {
      const base64 = await takeScreenshot();
      if (base64) {
        const res = await fetch(`data:image/png;base64,${base64}`);
        const img = await prepareImage(await res.blob());
        setImages((prev) => [...prev, img]);
      }
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : String(err));
    } finally {
      setShooting(false);
    }
  }

  function resetDraft() {
    setText("");
    setImages([]);
    setDocuments([]);
    setAttachError(null);
    setCanvasOpen(false);
    setPaletteOpen(false);
    setMentionOpen(false);
    setHistoryIndex(null);
    setCaret(0);
  }

  /**
   * Run a resolved slash command. Behavior is keyed by `command.kind`
   * (built-in code — plugin contributions are declarative, never executed):
   *
   * - `terminal` — stage `args` for explicit user confirmation (the gate below),
   *   never auto-run.
   * - `transform` — send `args` as a normal message.
   * - `note` — a contributed command with no host handler: explain it in-chat.
   */
  function runCommand(command: SlashCommand, args: string) {
    if (command.kind === "terminal") {
      if (!args.trim()) {
        setAttachError(tNow("composer.terminalUsage"));
        return;
      }
      // SAFETY GATE: never execute model/user shell input silently. Stash it and
      // surface an explicit confirm prompt; staging only happens on confirm.
      setPendingCommand({ command, args });
      resetDraft();
      return;
    }
    if (command.kind === "transform") {
      onSend(args, images, documents);
      resetDraft();
      return;
    }
    // Unknown/declarative contribution — no executable handler in the host.
    void postNote(
      tNow("composer.pluginCommandNote", { command: command.command }),
    );
    resetDraft();
  }

  function send() {
    const trimmed = text.trim();
    if (busy || !providerEnabled || keyReady === false) return;

    // Slash-command routing: if the input parses as a *known* command, run it
    // instead of sending a normal message. Unknown `/foo` and `//literal` fall
    // through to a normal send (so the user can still send text starting "/").
    const parsed = parseSlashInput(text);
    if (parsed) {
      const command = resolveCommand(parsed, commands);
      if (command) {
        runCommand(command, parsed.args);
        return;
      }
    }

    if (!trimmed && images.length === 0 && documents.length === 0) return;
    onSend(trimmed, images, documents);
    resetDraft();
  }

  /** Insert the selected command into the input, ready for the user's args. */
  function pickCommand(command: SlashCommand) {
    setText(`${command.command} `);
    setPaletteOpen(false);
  }

  /** Stage the pending terminal command in an OS terminal (after confirmation). */
  async function confirmPendingCommand() {
    const pending = pendingCommand;
    setPendingCommand(null);
    if (!pending) return;
    try {
      await openInTerminal(pending.args);
      await postNote(
        tNow("composer.terminalStagedNote") +
          "\n\n```bash\n" +
          pending.args +
          "\n```",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAttachError(tNow("composer.terminalOpenError", { error: msg }));
    }
  }

  // The selected provider being disabled overrides the no-key gating (the key
  // check is moot when the provider can't be used at all). Composes with T6.
  const noKey = providerEnabled && keyReady === false;
  const composeDisabled =
    busy || !providerEnabled || noKey || cloudBlockedOffline;
  // Sending is held while a document is mid-extraction so it can't be dropped.
  const canSend =
    !composeDisabled &&
    !extracting &&
    (text.trim().length > 0 || images.length > 0 || documents.length > 0);

  return (
    <div
      className="bg-card shadow-sm composer-shimmer @container/composer flex flex-col gap-3 rounded-xl border p-5 transition-shadow focus-within:ring-primary/40 focus-within:ring-2 @max-[20rem]/composer:[zoom:0.9] @max-[16rem]/composer:[zoom:0.8]"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void addFiles(filesFromDataTransfer(e.dataTransfer));
      }}
    >
      {canvasOpen && (
        // Canvas stays images-only (v1): staged documents keep flowing through
        // the normal send path below; they just aren't previewed in the canvas.
        <Canvas
          text={text}
          onChange={setText}
          images={images}
          onRemoveImage={removeImage}
          onReplaceImage={replaceImage}
          onSend={send}
          canSend={canSend}
          onClose={() => setCanvasOpen(false)}
        />
      )}

      {!providerEnabled &&
        (anyProvider ? (
          <p className="text-muted-foreground text-xs">
            {t("composer.providerDisabled", {
              provider: providerLabel(provider),
            })}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            {t("composer.noProviders")}
          </p>
        ))}
      {cloudBlockedOffline && (
        <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
          {t("composer.offline", { provider: providerLabel(provider) })}
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={switchToLocal}
          >
            {t("composer.useLocalModel")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={() => void refreshConnectivity()}
          >
            {t("composer.checkConnection")}
          </Button>
        </p>
      )}
      {noKey &&
        !cloudBlockedOffline &&
        (keyless ? (
          <p className="text-muted-foreground flex items-center gap-2 text-xs">
            {t("composer.ollamaDown")}
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={() => void refreshOllama()}
            >
              {t("composer.ollamaCheckAgain")}
            </Button>
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            {t("composer.noKey", { provider: providerLabel(provider) })}
          </p>
        ))}
      {attachError && <p className="text-destructive text-xs">{attachError}</p>}
      {recError && <p className="text-destructive text-xs">{recError}</p>}

      {/* Slash-command palette (T14): discovery/autocomplete while typing `/…`. */}
      {showPalette && (
        <div className="bg-popover text-popover-foreground overflow-hidden rounded-md border text-sm shadow-md">
          {matches.map((c, i) => (
            <button
              key={c.command}
              type="button"
              // Use onMouseDown so the click lands before the textarea blurs.
              onMouseDown={(e) => {
                e.preventDefault();
                pickCommand(c);
              }}
              onMouseEnter={() => setPaletteIndex(i)}
              className={`flex w-full items-start gap-2 px-3 py-2 text-left ${
                i === Math.min(paletteIndex, matches.length - 1)
                  ? "bg-accent text-accent-foreground"
                  : ""
              }`}
            >
              <span className="font-mono font-medium">{c.command}</span>
              <span className="text-muted-foreground truncate">
                {c.description}
              </span>
              {c.source === "plugin" && (
                <span className="text-muted-foreground ml-auto shrink-0 text-[10px] uppercase">
                  {t("composer.pluginBadge")}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Persona mention palette (T43): autocomplete while typing `@…`. */}
      {showMentionPalette && (
        <div
          aria-label={t("composer.mentionPaletteAria")}
          className="bg-popover text-popover-foreground overflow-hidden rounded-md border text-sm shadow-md"
        >
          {mentionMatches.map((b, i) => (
            <button
              key={b.id}
              type="button"
              // onMouseDown so the click lands before the textarea blurs.
              onMouseDown={(e) => {
                e.preventDefault();
                pickMention(b);
              }}
              onMouseEnter={() => setMentionIndex(i)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left ${
                i === Math.min(mentionIndex, mentionMatches.length - 1)
                  ? "bg-accent text-accent-foreground"
                  : ""
              }`}
            >
              <BotAvatar bot={b} className="size-5 shrink-0" />
              <span className="font-medium">{b.name}</span>
              {b.tagline && (
                <span className="text-muted-foreground truncate">
                  {b.tagline}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Confirmation gate for backend actions (T14 safety model). */}
      {pendingCommand && (
        <div className="border-primary/40 bg-muted/40 flex flex-col gap-2 rounded-md border p-3 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <TerminalSquare className="size-4" />
            {t("composer.runInTerminal")}
          </div>
          <p className="text-muted-foreground text-xs">
            {t("composer.terminalExplain")}
          </p>
          <pre className="bg-background overflow-x-auto rounded border p-2 font-mono text-xs whitespace-pre-wrap">
            {pendingCommand.args}
          </pre>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void confirmPendingCommand()}>
              {t("composer.stageInTerminal")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPendingCommand(null)}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}

      {(images.length > 0 || documents.length > 0 || extracting) && (
        <div className="flex flex-wrap items-center gap-2">
          {images.map((img, i) => (
            <ImageChip
              key={i}
              image={img}
              index={i}
              onRemove={removeImage}
              onReplace={replaceImage}
            />
          ))}
          {documents.map((doc, i) => (
            <div
              key={`doc-${i}`}
              title={doc.name}
              className="bg-muted/40 relative flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs"
            >
              <FileText className="size-4 shrink-0" aria-hidden />
              <span className="max-w-40 truncate">{doc.name}</span>
              {fileExtension(doc.name) && (
                <span className="text-muted-foreground text-[10px] font-semibold uppercase">
                  {fileExtension(doc.name)}
                </span>
              )}
              <span className="text-muted-foreground">
                {t("document.chars", { n: doc.text.length.toLocaleString() })}
              </span>
              <button
                type="button"
                aria-label={t("composer.removeDocument")}
                onClick={() => removeDocument(i)}
                className="bg-background/80 absolute -top-1.5 -right-1.5 rounded-full border p-0.5"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          {extracting && (
            <div className="bg-muted/40 text-muted-foreground flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("composer.extracting")}
            </div>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {recState !== "idle" && (
        <div className="bg-muted/40 flex items-center gap-3 rounded-lg border px-3 py-2">
          {recState === "recording" ? (
            <>
              <span className="relative flex size-2.5 shrink-0">
                <span className="bg-destructive absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
                <span className="bg-destructive relative inline-flex size-2.5 rounded-full" />
              </span>
              <SoundWave analyser={recAnalyser} className="flex-1" />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={cancelRecording}
              >
                {t("common.cancel")}
              </Button>
              <Button type="button" size="sm" onClick={() => void stopRecording()}>
                <Square className="size-4" />
                {t("composer.recordStop")}
              </Button>
            </>
          ) : (
            <span className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("composer.transcribing")}
            </span>
          )}
        </div>
      )}
      <Textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          // Editing a recalled prompt commits it to a normal draft — leave
          // arrow mode but keep what the user is now typing.
          if (historyIndex !== null) setHistoryIndex(null);
          setText(v);
          setCaret(e.target.selectionStart ?? v.length);
          // Open the palette when the user starts a slash command; reset the
          // highlight to the top as the filter changes.
          setPaletteOpen(v.startsWith("/") && !v.startsWith("//"));
          setPaletteIndex(0);
          // Re-arm the mention palette on every edit (Esc dismisses until the
          // next keystroke), and reset its highlight as the filter changes.
          setMentionOpen(true);
          setMentionIndex(0);
        }}
        // Caret moves without edits (click, arrow keys) retarget the mention
        // palette to the token now under the caret.
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onPaste={(e) => {
          const files = filesFromDataTransfer(e.clipboardData);
          if (files.length > 0) {
            e.preventDefault();
            void addFiles(files);
          }
        }}
        placeholder={t("composer.placeholder")}
        className="max-h-[260px] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
        onKeyDown={(e) => {
          // Palette navigation takes priority over send/newline.
          if (showPalette) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setPaletteIndex((i) => (i + 1) % matches.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setPaletteIndex((i) => (i - 1 + matches.length) % matches.length);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setPaletteOpen(false);
              return;
            }
            if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
              e.preventDefault();
              pickCommand(matches[Math.min(paletteIndex, matches.length - 1)]);
              return;
            }
          }
          // Mention palette (T43): same keys as the slash palette above.
          if (showMentionPalette) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setMentionIndex((i) => (i + 1) % mentionMatches.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setMentionIndex(
                (i) => (i - 1 + mentionMatches.length) % mentionMatches.length,
              );
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setMentionOpen(false);
              return;
            }
            if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
              e.preventDefault();
              pickMention(
                mentionMatches[
                  Math.min(mentionIndex, mentionMatches.length - 1)
                ],
              );
              return;
            }
          }
          // Prompt history recall (shell-style). Only when neither palette is
          // open; arrow mode starts from an empty field on ArrowUp.
          if (!showPalette && !showMentionPalette) {
            const idx = historyIndex;
            if (e.key === "ArrowUp" && (idx !== null || text.length === 0)) {
              if (userHistory.length === 0) return;
              e.preventDefault();
              showHistory(
                idx !== null ? Math.min(idx + 1, userHistory.length - 1) : 0,
              );
              return;
            }
            if (idx !== null && e.key === "ArrowDown") {
              e.preventDefault();
              // Past the most recent → back to an empty line.
              if (idx <= 0) exitHistory(true);
              else showHistory(idx - 1);
              return;
            }
            if (idx !== null && e.key === "ArrowRight") {
              // Accept the suggestion: keep it, leave arrow mode, caret to end.
              e.preventDefault();
              exitHistory(false);
              return;
            }
            if (idx !== null && e.key === "Escape") {
              e.preventDefault();
              exitHistory(true);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      {/* Context-size readout (T53): live estimate of the next request, with a
          usage bar when the active model has a configured max window. */}
      <div className="@max-[30rem]/composer:hidden">
        <ContextMeter
          model={model}
          messages={threadMessages}
          draftText={text}
          draftImageCount={images.length}
          draftDocuments={documents}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("composer.attachFile")}
          title={t("composer.attachFile")}
          disabled={composeDisabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("quick.takeScreenshot")}
          title={t("quick.takeScreenshot")}
          disabled={composeDisabled || shooting}
          onClick={() => void screenshot()}
        >
          {shooting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Camera className="size-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("composer.compact")}
          title={t("composer.compactTitle")}
          disabled={!compactEnabled}
          onClick={() => void compact()}
        >
          {compacting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FoldVertical className="size-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("composer.openCanvas")}
          title={t("composer.openCanvasTitle")}
          disabled={composeDisabled}
          onClick={() => setCanvasOpen(true)}
        >
          <Maximize2 className="size-4" />
        </Button>
        <Button
          variant={deepResearchOn ? "default" : "ghost"}
          size="icon"
          aria-label={t("composer.deepResearch")}
          aria-pressed={deepResearchOn}
          title={t("composer.deepResearchTitle")}
          disabled={busy}
          onClick={() => void setDeepResearch(!deepResearchOn)}
        >
          <Telescope className="size-4" />
        </Button>
        {/* T61: workspace file selector — visible when the thread/draft belongs
            to a workspace that has files. Hidden otherwise. */}
        <WorkspaceFileSelector />
        {/* Voice dictation (audio plugin): toggles recording → transcribe →
            insert into the field. Only shown when the audio plugin is enabled. */}
        {audioOn && (
          <Button
            variant={recState === "recording" ? "default" : "ghost"}
            size="icon"
            aria-label={t("composer.recordAudio")}
            aria-pressed={recState === "recording"}
            title={t("composer.recordAudio")}
            disabled={composeDisabled || recState === "transcribing"}
            onClick={() =>
              recState === "recording"
                ? void stopRecording()
                : void startRecording()
            }
          >
            {recState === "transcribing" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Mic className="size-4" />
            )}
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ModelPicker />
          {busy ? (
            <Button
              type="button"
              variant="destructive"
              onClick={onCancel}
              aria-label={t("composer.stopAria")}
              title={t("composer.stopAria")}
            >
              <Square className="size-4" />
              <span className="@max-[30rem]/composer:hidden">
                {t("composer.stop")}
              </span>
            </Button>
          ) : (
            <Button
              onClick={send}
              disabled={!canSend}
              aria-label={t("common.send")}
              title={t("common.send")}
            >
              <SendHorizontal className="hidden size-4 @max-[30rem]/composer:block" />
              <span className="@max-[30rem]/composer:hidden">
                {t("common.send")}
              </span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
