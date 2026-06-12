import { useMemo, useRef, useState } from "react";
import {
  Camera,
  FileText,
  FoldVertical,
  Loader2,
  Maximize2,
  Paperclip,
  Square,
  TerminalSquare,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Canvas } from "@/components/chat/Canvas";
import { ModelPicker } from "@/components/chat/ModelPicker";
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
import { selectRegistry, usePlugins } from "@/store/plugins";
import { useThreads } from "@/store/threads";
import { useKeys } from "@/store/keys";
import { useOllama } from "@/store/ollama";
import { t as tNow, useT } from "@/store/i18n";
import type { Provider } from "@/types/db";

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
  const threadMessages = useThreads((s) => s.messages);
  const compactEnabled =
    currentThreadId !== null &&
    !busy &&
    !compacting &&
    providerEnabled &&
    keyReady !== false &&
    canCompact(threadMessages);

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
  const composeDisabled = busy || !providerEnabled || noKey;
  // Sending is held while a document is mid-extraction so it can't be dropped.
  const canSend =
    !composeDisabled &&
    !extracting &&
    (text.trim().length > 0 || images.length > 0 || documents.length > 0);

  return (
    <div
      className="bg-card flex flex-col gap-2 rounded-xl border p-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void addFiles(e.dataTransfer.files);
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
      {noKey &&
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
            <div key={i} className="relative">
              <img
                src={img.dataUrl}
                alt={t("composer.attachmentPreview")}
                className="size-16 rounded-md object-cover"
              />
              <button
                type="button"
                aria-label={t("composer.removeImage")}
                onClick={() => removeImage(i)}
                className="bg-background/80 absolute -top-1.5 -right-1.5 rounded-full border p-0.5"
              >
                <X className="size-3" />
              </button>
            </div>
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
      <Textarea
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          // Open the palette when the user starts a slash command; reset the
          // highlight to the top as the filter changes.
          setPaletteOpen(v.startsWith("/") && !v.startsWith("//"));
          setPaletteIndex(0);
        }}
        onPaste={(e) => {
          // Any pasted *files* go through the attach flow (images, documents,
          // …); plain-text pastes have no files and stay normal text input.
          const files = Array.from(e.clipboardData.files);
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
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="flex items-center gap-2">
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
        <div className="flex-1" />
        <ModelPicker />
        {busy ? (
          <Button
            type="button"
            variant="destructive"
            onClick={onCancel}
            aria-label={t("composer.stopAria")}
          >
            <Square className="size-4" />
            {t("composer.stop")}
          </Button>
        ) : (
          <Button onClick={send} disabled={!canSend}>
            {t("common.send")}
          </Button>
        )}
      </div>
    </div>
  );
}
