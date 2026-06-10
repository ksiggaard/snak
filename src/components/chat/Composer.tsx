import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Paperclip, Square, TerminalSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Canvas } from "@/components/chat/Canvas";
import { ModelPicker } from "@/components/chat/ModelPicker";
import { prepareImage, type PreparedImage } from "@/lib/image";
import { hasApiKey } from "@/lib/keys";
import { useProviders } from "@/lib/providers";
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
import type { Provider } from "@/types/db";

interface ComposerProps {
  onSend: (text: string, images: PreparedImage[]) => void;
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
  const providers = useProviders();
  const providerLabel = (id: Provider) =>
    providers.find((p) => p.id === id)?.label ?? id;
  const [text, setText] = useState("");
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
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

  // Whether the selected provider has a stored API key. The value is reset to
  // `unknown` synchronously at render when the provider changes (the sanctioned
  // render-time sync pattern), then resolved by an async keychain check; the
  // cleanup flag drops a stale result if the provider switched again first.
  const [keyReady, setKeyReady] = useState<boolean | null>(null);
  const [checkedProvider, setCheckedProvider] = useState<Provider>(provider);
  if (provider !== checkedProvider) {
    setCheckedProvider(provider);
    setKeyReady(null);
  }
  useEffect(() => {
    let active = true;
    void hasApiKey(provider).then((ok) => {
      if (active) setKeyReady(ok);
    });
    return () => {
      active = false;
    };
  }, [provider]);

  async function addFiles(files: Iterable<File>) {
    const imageFiles = Array.from(files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (imageFiles.length === 0) return;
    setAttachError(null);
    try {
      const prepared = await Promise.all(imageFiles.map((f) => prepareImage(f)));
      setImages((prev) => [...prev, ...prepared]);
    } catch {
      setAttachError(
        "Couldn't process that image — it may be too large or an unsupported format.",
      );
    }
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  function resetDraft() {
    setText("");
    setImages([]);
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
        setAttachError("Usage: /terminal <shell command>");
        return;
      }
      // SAFETY GATE: never execute model/user shell input silently. Stash it and
      // surface an explicit confirm prompt; staging only happens on confirm.
      setPendingCommand({ command, args });
      resetDraft();
      return;
    }
    if (command.kind === "transform") {
      onSend(args, images);
      resetDraft();
      return;
    }
    // Unknown/declarative contribution — no executable handler in the host.
    void postNote(
      `The \`${command.command}\` command is provided by a plugin but has no ` +
        `built-in action in this host, so it can't run here.`,
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

    if (!trimmed && images.length === 0) return;
    onSend(trimmed, images);
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
        "Staged this command in your terminal — review it and press Enter " +
          "there to run it (it was not auto-executed):\n\n```bash\n" +
          pending.args +
          "\n```",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAttachError(`Couldn't open a terminal: ${msg}`);
    }
  }

  // The selected provider being disabled overrides the no-key gating (the key
  // check is moot when the provider can't be used at all). Composes with T6.
  const noKey = providerEnabled && keyReady === false;
  const composeDisabled = busy || !providerEnabled || noKey;
  const canSend = !composeDisabled && (text.trim().length > 0 || images.length > 0);

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
            “{providerLabel(provider)}” is disabled. Pick another provider above,
            or re-enable it in Settings → Plugins.
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            No providers are enabled. Enable a provider plugin in Settings →
            Plugins to start chatting.
          </p>
        ))}
      {noKey && (
        <p className="text-muted-foreground text-xs">
          No API key set for {providerLabel(provider)}. Add one in Settings to
          send messages.
        </p>
      )}
      {attachError && (
        <p className="text-destructive text-xs">{attachError}</p>
      )}

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
                  plugin
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
            Run this in a terminal?
          </div>
          <p className="text-muted-foreground text-xs">
            The command below will be <strong>staged</strong> in your terminal
            for review — it is never auto-executed. You press Enter there to run
            it.
          </p>
          <pre className="bg-background overflow-x-auto rounded border p-2 font-mono text-xs whitespace-pre-wrap">
            {pendingCommand.args}
          </pre>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void confirmPendingCommand()}>
              Stage in terminal
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPendingCommand(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((img, i) => (
            <div key={i} className="relative">
              <img
                src={img.dataUrl}
                alt="attachment preview"
                className="size-16 rounded-md object-cover"
              />
              <button
                type="button"
                aria-label="Remove image"
                onClick={() => removeImage(i)}
                className="bg-background/80 absolute -top-1.5 -right-1.5 rounded-full border p-0.5"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
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
          const files = Array.from(e.clipboardData.files);
          if (files.some((f) => f.type.startsWith("image/"))) {
            e.preventDefault();
            void addFiles(files);
          }
        }}
        placeholder="Type a message…  ( / for commands · Enter to send · Shift+Enter for newline )"
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
          aria-label="Attach image"
          disabled={composeDisabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open canvas"
          title="Open canvas — a larger editor with live Markdown preview"
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
            aria-label="Stop generating"
          >
            <Square className="size-4" />
            Stop
          </Button>
        ) : (
          <Button onClick={send} disabled={!canSend}>
            Send
          </Button>
        )}
      </div>
    </div>
  );
}
