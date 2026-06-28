# T40 — Personas: rebrand bots + profile fields, self-managed memory, mood

- **Status:** done
- **Owner:** Claude (T40 wave)
- **Priority:** P2
- **Layer:** DB (migration) + Frontend
- **Depends on:** T38

(Kasper, 2026-06-12.) Evolve T38 bots into **Personas** — it should feel like a
relationship with a person. Rebrand the UI (code/tables keep the `bots` naming);
split the profile into predefined fields; let the persona administer its own
memory; give it a persistent mood; both behaviors per-persona toggleable.

**Acceptance criteria:**
- **Rebrand:** every user-facing "Bot(s)" string becomes "Persona(s)" across all six
  languages. Internal identifiers/tables stay `bots` (no schema-rename churn).
- **Profile fields** (migration, additive): **Personality** (existing
  `instructions` column, relabeled), **Modus operandi**, **Tone of voice** — each an
  editor textarea and a labeled section in the persona system text.
- **Self-administered memory:** after each completed exchange in a persona thread
  (skipped for incognito threads), a follow-up call to the thread's model reviews the
  exchange against the persona's current memories and returns strict JSON ops
  (add/update/delete, hard caps); ops apply to the existing `bot_memory` table.
  Auto-added entries are visibly badged in the editor ("added by {name}") and remain
  fully user-editable/deletable. Failures are silent (never disturb the chat); usage
  is recorded (T16).
- **Mood:** a persistent short mood on the persona, updated by the same call when
  warranted ("a little hurt — the user snapped"), injected into the system prompt so
  it colors replies, shown in the editor with a clear/reset control.
- **Toggles:** per-persona "Let {name} manage their own memory" and "Mood", both
  default ON; the follow-up call only runs when at least one is enabled, and each
  result is applied only per its own flag.

**Notes:**
- Memory ops must round-trip through the frontend (frontend owns the DB — Stage 1);
  no Rust tool-use path. The extraction call reuses `chatStream` non-streamed.
- 2026-06-12 (Claude): Done. Migration **015** (`modus_operandi`, `tone_of_voice`,
  `auto_memory`/`mood_enabled` default 1, `mood`, `bot_memory.source 'user'|'auto'`).
  System text order: header → personality → "How you work" → "Tone of voice" →
  mood (toggle-gated — a lingering mood never leaks once off) → memory.
  **Engine** (`src/lib/personaMemory.ts`, parse layer unit-tested):
  `runPersonaMemoryUpdate` reviews each completed exchange on the thread's model
  via a strict-JSON prompt (current memories with ids + mood + the exchange),
  parses tolerantly (garbage → no-op), clamps (≤3 adds/turn, 300 chars/memory,
  120/mood), filters unknown ids, applies memory only under `auto_memory` and
  mood only under `mood_enabled`, auto-adds as `source: 'auto'`, never throws.
  Fire-and-forget at the end of `send()` — **skipped for incognito threads** and
  when both toggles are off (store-tested). Usage recording skipped (usage rows
  need message/thread FKs the background call lacks; documented). **UI:** editor
  gains Modus operandi + Tone of voice, two Switch toggles, a current-mood line
  with Reset, and "added by {name}" badges on auto memories. **Rebrand:** all
  user-facing Bot strings → Persona in six languages; code/tables keep `bots`.
  Verified: npm build/lint/test (401) + cargo build/clippy/fmt green.
