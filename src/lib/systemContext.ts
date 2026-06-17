import type { UserMemory, WorkspaceMemory } from "@/types/db";

/**
 * T10 system-context composition.
 *
 * Two global, user-editable inputs (Settings → "System prompt & memory"):
 *  - a custom **system-prompt addendum** (free text, stored in the `settings`
 *    table under `system_prompt_addendum`), and
 *  - a list of **user-memory** entries (the `user_memory` table, migration 005).
 *
 * Both are *global* (apply to every thread/provider) — the simplest model, and
 * documented as such. They are combined into a single leading `role:"system"`
 * message, ordered **before** the per-project system message (T20). Because
 * every provider concatenates consecutive `system`-role messages in array order
 * (Anthropic/Gemini join them with `\n\n`; OpenAI/Mistral pass them through as
 * separate system turns), the resulting precedence is:
 *
 *     global (addendum + memory)  →  project (instructions + files)  →  thread
 *
 * "Thread" here is the conversation history itself — there is no separate
 * per-thread system prompt in this app, so the thread layer is the messages.
 */

/**
 * Build the global system text from the custom addendum and the user's memory
 * entries. Returns an empty string when both are empty/blank — callers should
 * skip adding a system message in that case (so existing chats are unaffected
 * when the user hasn't configured anything).
 */
export function buildGlobalSystemText(
  addendum: string | null | undefined,
  memory: Pick<UserMemory, "content">[],
): string {
  const sections: string[] = [];

  const trimmedAddendum = (addendum ?? "").trim();
  if (trimmedAddendum) {
    sections.push(trimmedAddendum);
  }

  const memoryLines = memory
    .map((m) => m.content.trim())
    .filter((c) => c.length > 0)
    .map((c) => `- ${c}`);

  if (memoryLines.length > 0) {
    sections.push(
      ["Memory about the user:", ...memoryLines].join("\n"),
    );
  }

  return sections.join("\n\n");
}

/**
 * T62: Build the workspace memory system text from the workspace's memory
 * entries. Returns an empty string when there are no non-empty entries —
 * callers should skip adding a system message in that case.
 *
 * Formatted as a "Memory for this workspace:" bulleted list, parallel to the
 * "Memory about the user:" block in `buildGlobalSystemText`.
 */
export function buildWorkspaceMemoryText(
  memory: Pick<WorkspaceMemory, "content">[],
): string {
  const memoryLines = memory
    .map((m) => m.content.trim())
    .filter((c) => c.length > 0)
    .map((c) => `- ${c}`);

  if (memoryLines.length === 0) return "";

  return ["Memory for this workspace:", ...memoryLines].join("\n");
}
