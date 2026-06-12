import {
  addBotMemory,
  deleteBotMemory,
  listBotMemory,
  setBotMood,
  updateBotMemory,
} from "@/lib/db";
import { chatStream, type ApiMessage } from "@/lib/chat";
import { useBots } from "@/store/bots";
import type { Bot, BotMemory, Provider } from "@/types/db";

/**
 * T40 persona self-managed memory + mood. After each completed exchange in a
 * persona thread, `send()` fires `runPersonaMemoryUpdate` off-path: a
 * follow-up call to the thread's model reviews the exchange against the
 * persona's current memories and returns strict-JSON ops (add/update/delete +
 * an optional new mood), which are applied to the existing `bot_memory` table
 * and `bots.mood` — all through the frontend, which owns the DB (Stage 1).
 *
 * The pure parts (`buildMemoryUpdateMessages`, `parseMemoryOps`) are
 * unit-tested; the impure runner never throws (failures must never disturb
 * the chat).
 */

/** Memory/mood operations parsed from the model's JSON reply. */
export interface MemoryOps {
  add: string[];
  update: { id: string; content: string }[];
  delete: string[];
  /** New mood to persist, or null for "unchanged". */
  mood: string | null;
}

/** Hard cap on new memories per exchange — keeps a chatty model in check. */
export const MAX_AUTO_ADDS_PER_TURN = 3;
/** Max length of one memory entry (added or updated). */
export const MAX_MEMORY_CHARS = 300;
/** Max length of the persisted mood phrase. */
export const MAX_MOOD_CHARS = 120;

/** Max chars of each exchange side carried into the review call. */
const MAX_EXCHANGE_CHARS = 4000;

const truncate = (text: string, max: number) =>
  text.length > max ? text.slice(0, max) : text;

/**
 * Build the two-message request for the memory-review call: a system prompt
 * describing the manager role, the current memories (with ids, so updates/
 * deletes can reference them) and mood, plus a user message carrying the
 * exchange. Pure.
 */
export function buildMemoryUpdateMessages(
  bot: Pick<Bot, "name" | "mood_enabled" | "mood">,
  memories: BotMemory[],
  userText: string,
  assistantText: string,
): ApiMessage[] {
  const name = bot.name.trim() || "the persona";
  const moodEnabled = Boolean(bot.mood_enabled);

  const memoryLines =
    memories.length > 0
      ? memories.map((m) => `- ${m.id}: ${m.content}`).join("\n")
      : "(none)";

  const decisions = [
    `1. Does the exchange reveal durable facts about the user worth remembering for future conversations? Life facts (e.g. "has two kids"), preferences, ongoing situations, how they want to be treated.`,
    ...(moodEnabled
      ? [
          `2. How does ${name} feel after this exchange? A short phrase, e.g. "cheerful" or "a little hurt — the user snapped".`,
        ]
      : []),
  ].join("\n");

  const system = [
    `You are the private memory manager for ${name}, a persona the user chats with. After each exchange you decide:`,
    decisions,
    `Current memories (id: content):\n${memoryLines}`,
    `Current mood: ${bot.mood.trim() || "(neutral)"}`,
    `Reply with ONLY a JSON object — no prose, no code fence:\n{"add": string[], "update": [{"id": string, "content": string}], "delete": string[], "mood": string | null}`,
    [
      `- "add" holds new memories (at most ${MAX_AUTO_ADDS_PER_TURN} per exchange); "update" and "delete" reference existing memory ids.`,
      `- Most exchanges warrant NO changes: reply with empty arrays and null mood.`,
      `- Keep each memory one short sentence. Never store secrets, passwords, or credentials.`,
      moodEnabled
        ? `- "mood" replaces the current mood when this exchange changed how ${name} feels; use null to leave it unchanged.`
        : `- Mood is disabled for ${name}: "mood" must always be null.`,
    ].join("\n"),
  ].join("\n\n");

  const exchange = [
    `User said:\n${truncate(userText, MAX_EXCHANGE_CHARS)}`,
    `${name} replied:\n${truncate(assistantText, MAX_EXCHANGE_CHARS)}`,
  ].join("\n\n");

  return [
    { role: "system", content: system, images: [] },
    { role: "user", content: exchange, images: [] },
  ];
}

/**
 * Parse the model's reply into `MemoryOps` — tolerantly. Strips a wrapping
 * code fence and any prose around the outermost `{…}`, then validates and
 * clamps: adds are capped at `MAX_AUTO_ADDS_PER_TURN`, every entry/mood is
 * sliced to its max length, non-string entries are dropped. Unknown ids are
 * NOT filtered here — the applier checks them against the live rows. Returns
 * null for anything unusable. Pure.
 */
export function parseMemoryOps(raw: string): MemoryOps | null {
  let text = raw.trim();
  // Strip a wrapping ``` / ```json fence, if any.
  const fence = /^```[A-Za-z]*\s*([\s\S]*?)\s*```$/.exec(text);
  if (fence) text = fence[1].trim();
  // Tolerate prose around the JSON: take the outermost {...} span.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const v = parsed as Record<string, unknown>;

  const strings = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((x): x is string => typeof x === "string")
      : [];

  const add = strings(v.add)
    .map((s) => truncate(s.trim(), MAX_MEMORY_CHARS))
    .filter((s) => s.length > 0)
    .slice(0, MAX_AUTO_ADDS_PER_TURN);

  const update = (Array.isArray(v.update) ? v.update : [])
    .filter(
      (x): x is { id: string; content: string } =>
        typeof x === "object" &&
        x !== null &&
        typeof (x as Record<string, unknown>).id === "string" &&
        typeof (x as Record<string, unknown>).content === "string",
    )
    .map((x) => ({
      id: x.id,
      content: truncate(x.content.trim(), MAX_MEMORY_CHARS),
    }))
    .filter((x) => x.content.length > 0);

  const del = strings(v.delete);

  const mood =
    typeof v.mood === "string" ? truncate(v.mood.trim(), MAX_MOOD_CHARS) : null;

  return { add, update, delete: del, mood };
}

/**
 * Run the full memory-review round for one completed exchange: load the
 * persona's memories, call the thread's model (non-streamed — deltas are
 * ignored), parse the ops, and apply them per the persona's flags:
 * `auto_memory` gates the memory ops, `mood_enabled` gates the mood (the
 * caller only fires this when at least one is enabled). Auto-added rows get
 * `source: "auto"` so the editor can badge them. Fire-and-forget: every
 * failure is swallowed with a console.warn — this must never disturb the
 * chat that triggered it.
 *
 * Usage recording (T16) is intentionally skipped: `usage` rows are hard-bound
 * to a persisted message + thread (NOT NULL FKs), and this background call
 * has neither in scope.
 */
export async function runPersonaMemoryUpdate(
  bot: Bot,
  userText: string,
  assistantText: string,
  provider: Provider,
  model: string,
): Promise<void> {
  try {
    const memories = await listBotMemory(bot.id);
    const messages = buildMemoryUpdateMessages(
      bot,
      memories,
      userText,
      assistantText,
    );
    const result = await chatStream(provider, model, messages, () => {});
    const ops = parseMemoryOps(result.content);
    if (!ops) return;

    if (bot.auto_memory) {
      // Only ids that actually exist are touched — the model may hallucinate.
      const known = new Set(memories.map((m) => m.id));
      for (const id of ops.delete) {
        if (known.has(id)) await deleteBotMemory(id);
      }
      const deleted = new Set(ops.delete);
      for (const u of ops.update) {
        if (known.has(u.id) && !deleted.has(u.id)) {
          await updateBotMemory(u.id, u.content);
        }
      }
      for (const content of ops.add) {
        await addBotMemory(bot.id, content, "auto");
      }
    }
    if (bot.mood_enabled && ops.mood !== null) {
      await setBotMood(bot.id, ops.mood);
    }
    // Reflect a changed mood (and updated_at) in any open editor/list.
    await useBots.getState().refresh();
  } catch (e) {
    console.warn("Persona memory update failed:", e);
  }
}
