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
 * persona header, the bot's personality instructions, and its memory entries.
 * Returns an empty string when everything is blank — callers should skip
 * adding a system message in that case.
 */
export function buildBotSystemText(
  bot: Pick<Bot, "name" | "instructions" | "tagline">,
  memory: Pick<BotMemory, "content">[],
): string {
  const sections: string[] = [];

  const name = bot.name.trim();
  const tagline = bot.tagline.trim();
  if (name) {
    // The tagline ("The IT architect") is part of who the persona is.
    const who = tagline ? `${name} (${tagline})` : name;
    sections.push(
      `You are ${who}, a persona the user created. Stay in character as ${name}.`,
    );
  }

  const instructions = bot.instructions.trim();
  if (instructions) {
    sections.push(instructions);
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

/** Data URL for a bot's uploaded avatar, or null for the monogram fallback. */
export function botAvatarUrl(
  bot: Pick<Bot, "avatar_media_type" | "avatar_data">,
): string | null {
  if (!bot.avatar_media_type || !bot.avatar_data) return null;
  return `data:${bot.avatar_media_type};base64,${bot.avatar_data}`;
}

/** The monogram shown when a bot has no avatar: the name's first grapheme,
 * uppercased ("?" for a blank name). `Array.from` splits by code point, so
 * emoji/astral characters survive intact. */
export function botMonogram(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : "?";
}
