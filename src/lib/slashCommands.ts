// T14 slash-command support.
//
// Slash commands let the user type `/command args` in the composer to transform
// input, inject context, or run a backend action whose output feeds the thread.
//
// ## Architecture
//
// - **Parsing** (`parseSlashInput`) is pure and turns a raw composer string into
//   `{ name, args }` or `null` (not a slash command). It only treats text that
//   *starts* with `/` and whose first token is a valid command word as a command,
//   so a message that merely contains a slash mid-line is sent normally.
// - **Discovery / resolution** (`availableCommands`, `matchCommands`,
//   `resolveCommand`) combines **built-in** commands (defined here) with
//   **plugin-contributed** ones (T12 `slash-command` category →
//   `{ command, description }`, read off the host registry). The palette in the
//   Composer renders `matchCommands(...)`; confirming runs `resolveCommand(...)`.
// - **Behavior is built-in code keyed by command name.** Per the T12 security
//   model, plugin contributions are *declarative* (`{ command, description }`) —
//   they advertise a command but never ship executable code. A contribution that
//   doesn't map to a known built-in handler is surfaced as discoverable but, when
//   run, produces an explanatory chat note rather than executing anything. This
//   keeps the host from `eval`-ing third-party logic.
//
// The reference command is `/terminal <cmd>` — see `COMMAND_KIND.terminal`. It
// NEVER auto-runs: it stages the command in an OS terminal (T17
// `open_in_terminal`) only after explicit user confirmation, and drops a note
// into the chat. The confirmation gate lives in the Composer (the handler here
// is pure data describing what to do).

import type { SlashCommandContribution } from "@/types/plugins";

/** A parsed slash input: the command word (sans leading `/`) and the rest. */
export interface ParsedSlash {
  /** Command name without the leading slash, lowercased. */
  name: string;
  /** Everything after the command word, trimmed (may be empty). */
  args: string;
}

/**
 * What running a resolved command should do. The Composer interprets this:
 *
 * - `terminal` — stage `args` in an OS terminal behind a confirmation gate, then
 *   post a chat note. The reference command.
 * - `prompt` — a user-authored prompt template: merge the saved `instructions`
 *   with the typed `args` (via `applyTemplate`) and send as a normal message.
 * - `compact` / `research` / `help` — built-in shortcuts to existing app
 *   functionality (history compaction, deep-research mode, a keyboard-shortcut
 *   cheat sheet). Handled in the Composer.
 * - `transform` — replace the composer text with `args` and send it as a normal
 *   message (an escape hatch for a literal message beginning with a slash).
 * - `note` — a contributed command with no built-in handler: inject an
 *   explanatory assistant-side note instead of executing anything.
 */
export type CommandKind =
  | "terminal"
  | "prompt"
  | "compact"
  | "research"
  | "help"
  | "transform"
  | "note";

/** A command available in the palette (built-in, user-authored, or plugin). */
export interface SlashCommand {
  /** The command word *with* leading slash, e.g. "/terminal". */
  command: string;
  /** Short human description shown in the palette. */
  description: string;
  /** How the Composer should execute it. */
  kind: CommandKind;
  /** Where it came from (for the palette badge / debugging). */
  source: "builtin" | "plugin" | "user";
  /** True if it needs an argument string to do anything. */
  requiresArgs: boolean;
  /** Prompt template for `kind: "prompt"` (user commands); may contain `{input}`. */
  instructions?: string;
}

/**
 * A user-authored slash command (Settings → Slash commands). Three fields: the
 * trigger word, an input hint (documents the expected argument, shown in the
 * palette), and the instructions template. Stored as JSON in the `settings`
 * table and sent to the model as a prompt template — never executed as code.
 */
export interface UserSlashCommand {
  /** Stable id (crypto.randomUUID), used as the React key and for edits. */
  id: string;
  /** The command word, e.g. "/proof-read" (leading slash, normalized on save). */
  command: string;
  /** Hint for the expected argument; shown as the palette description. */
  input: string;
  /** Prompt template for how to handle the request; may contain `{input}`. */
  instructions: string;
}

/** Built-in commands shipped with the app (behavior keyed by name). */
export const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    command: "/terminal",
    description:
      "Stage a shell command in your terminal (review & run it yourself — never auto-run).",
    kind: "terminal",
    source: "builtin",
    requiresArgs: true,
  },
  {
    command: "/compact",
    description: "Summarize older messages to free up the context window.",
    kind: "compact",
    source: "builtin",
    requiresArgs: false,
  },
  {
    command: "/research",
    description:
      "Turn on deep research and send your question — the model dispatches subagents.",
    kind: "research",
    source: "builtin",
    requiresArgs: false,
  },
  {
    command: "/help",
    description: "Show keyboard shortcuts.",
    kind: "help",
    source: "builtin",
    requiresArgs: false,
  },
];

/** Built-in command names — used to block user commands from shadowing them. */
export const BUILTIN_COMMAND_NAMES: string[] = BUILTIN_COMMANDS.map((c) =>
  normalizeName(c.command),
);

/** Normalize a command word: strip a single leading slash, lowercase. */
function normalizeName(word: string): string {
  return word.replace(/^\//, "").toLowerCase();
}

/** A valid command word is `/` + letters/digits/`-`/`_` (no spaces). */
const COMMAND_WORD = /^\/[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Normalize a user-typed command word to canonical `/lowercase`, or `null` if it
 * isn't a syntactically valid command word. Used by the settings editor to
 * validate and store user commands consistently with the palette.
 */
export function normalizeUserCommand(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return null;
  const word = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (!COMMAND_WORD.test(word)) return null;
  return `/${normalizeName(word)}`;
}

/**
 * Parse a raw composer string into a slash command, or `null` if it isn't one.
 *
 * Rules:
 * - Must start with `/` (after no leading whitespace — a leading space means the
 *   user is typing a normal message that happens to contain a slash).
 * - `//` (an escaped/literal leading slash) is NOT a command.
 * - The first token must be a syntactically valid command word.
 *
 * Returns `{ name, args }` with `name` lowercased and `args` the trimmed rest.
 */
export function parseSlashInput(raw: string): ParsedSlash | null {
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null;
  // First token = up to the first whitespace; rest = the remainder.
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(raw);
  if (!match) return null;
  const word = match[1];
  if (!COMMAND_WORD.test(word)) return null;
  return { name: normalizeName(word), args: (match[2] ?? "").trim() };
}

/**
 * The full set of available commands, by precedence **built-in > user > plugin**
 * (a higher-precedence command of the same name wins). User commands run their
 * `instructions` template (`kind: "prompt"`); plugin contributions are
 * declarative (`kind: "note"`) — we never execute their code.
 */
export function availableCommands(
  contributions: SlashCommandContribution[],
  userCommands: UserSlashCommand[] = [],
): SlashCommand[] {
  const byName = new Map<string, SlashCommand>();
  for (const c of BUILTIN_COMMANDS) {
    byName.set(normalizeName(c.command), c);
  }
  for (const uc of userCommands) {
    const raw = (uc.command ?? "").trim();
    if (raw === "") continue;
    const word = raw.startsWith("/") ? raw : `/${raw}`;
    if (!COMMAND_WORD.test(word)) continue;
    const name = normalizeName(word);
    if (byName.has(name)) continue; // built-in wins
    byName.set(name, {
      command: `/${name}`,
      description: (uc.input ?? "").trim() || "User command",
      kind: "prompt",
      source: "user",
      requiresArgs: false,
      instructions: uc.instructions ?? "",
    });
  }
  for (const c of contributions) {
    const word = (c.command ?? "").trim();
    if (word === "") continue;
    const name = normalizeName(word);
    if (byName.has(name)) continue; // built-in or user of the same name wins
    if (!COMMAND_WORD.test(word.startsWith("/") ? word : `/${word}`)) continue;
    byName.set(name, {
      command: `/${name}`,
      description: (c.description ?? "").trim() || "Plugin command",
      // Declarative contributions have no executable handler in the host.
      kind: "note",
      source: "plugin",
      requiresArgs: false,
    });
  }
  return Array.from(byName.values()).sort((a, b) =>
    a.command.localeCompare(b.command),
  );
}

/**
 * Combine a user command's instructions template with the typed args. If the
 * template contains `{input}`, the args are substituted there; otherwise they're
 * appended after the instructions. With no args, the template is sent as-is.
 */
export function applyTemplate(instructions: string, args: string): string {
  if (instructions.includes("{input}")) {
    // Function replacer so `$` sequences in args aren't treated as patterns.
    return instructions.replace(/\{input\}/g, () => args);
  }
  return args.trim() ? `${instructions}\n\n${args}` : instructions;
}

/**
 * Parse the stored user-commands JSON into a clean list. Tolerant: returns `[]`
 * for null/empty/malformed input and drops entries without a command word.
 */
export function parseUserCommands(
  json: string | null | undefined,
): UserSlashCommand[] {
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: UserSlashCommand[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const command = typeof e.command === "string" ? e.command : "";
    if (!command.trim()) continue;
    out.push({
      id: typeof e.id === "string" && e.id ? e.id : crypto.randomUUID(),
      command,
      input: typeof e.input === "string" ? e.input : "",
      instructions: typeof e.instructions === "string" ? e.instructions : "",
    });
  }
  return out;
}

/**
 * Commands whose name starts with the typed prefix (for autocomplete). `prefix`
 * may include the leading slash or not; an empty/`/`-only prefix lists all.
 * Case-insensitive, sorted with exact/closer matches first.
 */
export function matchCommands(
  prefix: string,
  commands: SlashCommand[],
): SlashCommand[] {
  const p = normalizeName(prefix.trim());
  if (p === "") return commands;
  return commands.filter((c) => normalizeName(c.command).startsWith(p));
}

/**
 * Resolve a parsed slash input to its command definition, or `null` if no such
 * command exists (the Composer then treats the text as a normal message).
 */
export function resolveCommand(
  parsed: ParsedSlash,
  commands: SlashCommand[],
): SlashCommand | null {
  return (
    commands.find((c) => normalizeName(c.command) === parsed.name) ?? null
  );
}
