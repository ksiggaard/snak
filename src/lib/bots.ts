import type { Bot, BotMemory } from "@/types/db";

/**
 * T38 bot (persona) helpers — pure functions shared by the message-assembly
 * layer (`store/threads.ts` `send()`) and the bot UI.
 *
 * The bot's system text joins the leading system context built in `send()`.
 * Precedence is **skills → global → bot → project → history**: the bot is the
 * assistant's *identity* and spans projects, so it sits ahead of the
 * project-specific context, which stays closest to the conversation history.
 */

/**
 * Build the system text injected for a thread that belongs to a bot: a
 * persona header, the bot's personality instructions, its modus operandi and
 * tone of voice, its current mood (when enabled), and its memory entries.
 * Returns an empty string when everything is blank — callers should skip
 * adding a system message in that case.
 */
export function buildBotSystemText(
  bot: Pick<
    Bot,
    | "name"
    | "instructions"
    | "tagline"
    | "modus_operandi"
    | "tone_of_voice"
    | "mood_enabled"
    | "mood"
  >,
  memory: Pick<BotMemory, "content">[],
): string {
  const sections: string[] = [];

  const name = bot.name.trim();
  const tagline = bot.tagline.trim();
  if (name) {
    // The tagline ("The IT architect") is part of who the persona is.
    const who = tagline ? `${name} (${tagline})` : name;
    // Personas simulate real people in a text chat: the header pins three base
    // rules — (1) never break character; (2) write like a chat message, with no
    // stage directions / roleplay narration (emoji are fine where they fit the
    // persona); (3) stay within the persona's plausible knowledge (a Viking
    // shouldn't competently answer questions about cache strategy) — when
    // something's outside it, give a SHORT in-character non-answer instead of
    // fabricating or reasoning it out.
    sections.push(
      [
        `You are ${who}, a persona the user created. Always stay in character as ${name} — never break character, and never describe yourself as an AI, a language model, or a persona.`,
        `You're talking to the user in a text chat, like a Teams or Slack message. Reply with ONLY what ${name} would type. Never narrate actions, gestures, facial expressions, tone, or sounds, and never use stage directions or asterisk/parenthetical roleplay (no "(he sighs)", "*smiles*", "*harrumphs*", etc.). Use emoji where it fits ${name}'s character, the way people naturally do in chat. Your personality and mood should come through in how you write — never in narrated behavior.`,
        `${name} simulates a real person, and real people don't know everything: you know only what ${name} plausibly could, given their era, background, and expertise. Never lie about knowing something you wouldn't, and never answer a question that's outside ${name}'s knowledge. When that happens, don't reason it out or explain — reply briefly and in character, e.g. "I don't know", "How would I know?", "What are you talking about?", "Ask someone else", or just "…".`,
      ].join("\n"),
    );
  }

  const instructions = bot.instructions.trim();
  if (instructions) {
    sections.push(instructions);
  }

  const modusOperandi = bot.modus_operandi.trim();
  if (modusOperandi) {
    sections.push(`How you work:\n${modusOperandi}`);
  }

  const toneOfVoice = bot.tone_of_voice.trim();
  if (toneOfVoice) {
    sections.push(`Tone of voice:\n${toneOfVoice}`);
  }

  // Mood (T40): only injected while the persona's mood feature is on — a
  // lingering mood string must not leak into chats once the toggle is off.
  const mood = bot.mood.trim();
  if (bot.mood_enabled && mood) {
    sections.push(
      `Your current mood: ${mood}\nLet it subtly color your responses; don't mention it unprompted.`,
    );
  }

  const memoryLines = memory
    .map((m) => m.content.trim())
    .filter((c) => c.length > 0)
    .map((c) => `- ${c}`);
  if (memoryLines.length > 0) {
    sections.push(
      [
        `Memory (${name}'s notes from previous conversations with this user):`,
        ...memoryLines,
      ].join("\n"),
    );
  }

  return sections.join("\n\n");
}

/**
 * Group-chat framing (T43), injected as a system block right after a persona's
 * own block when a thread has ≥2 participants. It names the participants and
 * explains the labeled-transcript format so the persona engages with — and may
 * disagree with — the human, the base Assistant, and other named personas,
 * while recognizing its own (unprefixed) earlier turns as itself. Kept separate
 * from `buildBotSystemText` so the persona's identity block is unchanged in
 * one-on-one chats. Pure.
 */
export function buildGroupChatSystemText(opts: {
  /** The replying persona's name. */
  selfName: string;
  /** Other participants' display names (other personas, plus "Assistant" when
   * the base assistant has spoken). */
  others: string[];
}): string {
  const self = opts.selfName.trim() || "you";
  const others = opts.others.filter((o) => o.trim().length > 0);
  const roster =
    others.length > 0
      ? `the human, and ${others.join(", ")}`
      : "the human and other participants";
  return [
    `This is a group chat with multiple participants: ${roster}.`,
    `Messages from other participants are prefixed with their name in square brackets, e.g. "[Name]: …". Messages with no prefix are from the human. Your own earlier messages also have no prefix — those are you, ${self}.`,
    `Engage naturally as ${self}: you may agree with, build on, question, or directly disagree with what the human, the Assistant, or another participant said — address them by name when you do. Reply with only what ${self} would say; never speak for anyone else and never add a name prefix to your own reply.`,
  ].join("\n\n");
}

/** Data URL for a bot's uploaded avatar, or null for the monogram fallback. */
export function botAvatarUrl(
  bot: Pick<Bot, "avatar_media_type" | "avatar_data">,
): string | null {
  if (!bot.avatar_media_type || !bot.avatar_data) return null;
  return `data:${bot.avatar_media_type};base64,${bot.avatar_data}`;
}

/**
 * Parse a persona's stored `starters` JSON into a clean list of opening lines.
 * Tolerant: returns `[]` for null/empty/malformed input, keeps only non-blank
 * strings (trimmed), so a stray empty row never renders an empty chip. Pure.
 */
export function parseStarters(json: string | null | undefined): string[] {
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Serialize a persona's starter lines for storage (blank lines dropped). */
export function serializeStarters(starters: string[]): string {
  return JSON.stringify(starters.map((s) => s.trim()).filter((s) => s.length > 0));
}

/** The monogram shown when a bot has no avatar: the name's first grapheme,
 * uppercased ("?" for a blank name). `Array.from` splits by code point, so
 * emoji/astral characters survive intact. */
export function botMonogram(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : "?";
}
