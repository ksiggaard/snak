import Database from "@tauri-apps/plugin-sql";
import { WEB_ONLY } from "@/lib/webOnly";
import { webDb } from "@/lib/webdb";
import { buildFtsMatch, searchTerms } from "@/lib/search";
import type {
  Artifact,
  ArtifactFile,
  LibraryArtifact,
  Attachment,
  AttachmentKind,
  Bot,
  BotMemory,
  Message,
  MessageKind,
  Model,
  Workspace,
  WorkspaceFile,
  WorkspaceMemory,
  Provider,
  Role,
  SearchHit,
  Thread,
  Usage,
  UserMemory,
} from "@/types/db";

// Must match `DB_URL` in src-tauri/src/lib.rs. Migrations are run by the
// backend on startup; here we just connect.
const DB_URL = "sqlite:snak.db";

let dbPromise: Promise<Database> | null = null;

/** Lazily open (once) and reuse the SQLite connection. In WEB_ONLY mode there's
 * no tauri-plugin-sql backend, so hand back an in-memory fake (lib/webdb.ts). */
export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = WEB_ONLY ? Promise.resolve(webDb) : Database.load(DB_URL);
  }
  return dbPromise;
}

const newId = () => crypto.randomUUID();

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export async function createThread(input: {
  provider: Provider;
  model: string;
  title?: string;
  /** Optional workspace to create the thread inside. */
  workspaceId?: string | null;
  /** Incognito (T29): session-only — purged on the next app launch. */
  ephemeral?: boolean;
  /** Bot (T38): the persona this thread belongs to, or null for none. */
  botId?: string | null;
}): Promise<Thread> {
  const db = await getDb();
  const id = newId();
  await db.execute(
    `INSERT INTO threads (id, title, provider, model, workspace_id, ephemeral, bot_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      input.title ?? "New chat",
      input.provider,
      input.model,
      input.workspaceId ?? null,
      input.ephemeral ? 1 : 0,
      input.botId ?? null,
    ],
  );
  const thread = await getThread(id);
  if (!thread) throw new Error("Failed to read back created thread");
  return thread;
}

export async function listThreads(): Promise<Thread[]> {
  const db = await getDb();
  return db.select<Thread[]>(
    `SELECT * FROM threads ORDER BY updated_at DESC, created_at DESC`,
  );
}

export async function getThread(id: string): Promise<Thread | null> {
  const db = await getDb();
  const rows = await db.select<Thread[]>(
    `SELECT * FROM threads WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function renameThread(id: string, title: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE threads SET title = $1, updated_at = datetime('now') WHERE id = $2`,
    [title, id],
  );
}

export async function setThreadProviderModel(
  id: string,
  provider: Provider,
  model: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE threads SET provider = $1, model = $2, updated_at = datetime('now')
     WHERE id = $3`,
    [provider, model, id],
  );
}

/** Persist the per-chat excluded workspace-file ids (T61). Pass an empty array
 * or null to restore "all selected". Does not bump updated_at — toggling file
 * selection shouldn't reorder the recents list. */
export async function setThreadWorkspaceFilesExcluded(
  id: string,
  excludedIds: string[],
): Promise<void> {
  const db = await getDb();
  const value = excludedIds.length === 0 ? null : JSON.stringify(excludedIds);
  await db.execute(
    `UPDATE threads SET workspace_files_excluded = $1 WHERE id = $2`,
    [value, id],
  );
}

/** Assign (or clear, with null) the workspace a thread belongs to. */
export async function setThreadWorkspace(
  id: string,
  workspaceId: string | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE threads SET workspace_id = $1, updated_at = datetime('now')
     WHERE id = $2`,
    [workspaceId, id],
  );
}

/** Pin/unpin a thread to the sidebar Favorites group (T23). Does not bump
 * updated_at — favoriting shouldn't reorder the recents list. */
export async function setThreadFavorite(
  id: string,
  favorite: boolean,
): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE threads SET favorite = $1 WHERE id = $2`, [
    favorite ? 1 : 0,
    id,
  ]);
}

/** Archive (close-tab) / un-archive a thread. Does not bump updated_at, so
 * archiving and promoting never reorder the recency list. */
export async function setThreadArchived(
  id: string,
  archived: boolean,
): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE threads SET archived = $1 WHERE id = $2`, [
    archived ? 1 : 0,
    id,
  ]);
}

/** Turn deep research mode on/off for a thread (T55). Does not bump updated_at —
 * toggling the mode shouldn't reorder the recents list. */
export async function setThreadDeepResearch(
  id: string,
  deepResearch: boolean,
): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE threads SET deep_research = $1 WHERE id = $2`, [
    deepResearch ? 1 : 0,
    id,
  ]);
}

/** Set a thread's response-style output type (an `OutputTypeId`). Does not bump
 *  updated_at (mirrors setThreadDeepResearch). */
export async function setThreadOutputType(
  id: string,
  outputType: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE threads SET output_type = $1 WHERE id = $2`, [
    outputType,
    id,
  ]);
}

/** Turn planner mode on/off for a thread. When turning on, pass the current
 * provider+model so they can be restored when toggling off. */
export async function setThreadPlannerActive(
  id: string,
  active: boolean,
  prePlannerProvider?: Provider | null,
  prePlannerModel?: string | null,
): Promise<void> {
  const db = await getDb();
  if (active) {
    await db.execute(
      `UPDATE threads SET planner_active = 1, pre_planner_provider = $2, pre_planner_model = $3 WHERE id = $1`,
      [id, prePlannerProvider ?? null, prePlannerModel ?? null],
    );
  } else {
    await db.execute(
      `UPDATE threads SET planner_active = 0, pre_planner_provider = NULL, pre_planner_model = NULL WHERE id = $1`,
      [id],
    );
  }
}

/** Restore the saved pre-planner provider+model when toggling planner off. */
export async function restoreThreadPrePlannerModel(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE threads
        SET provider = COALESCE(pre_planner_provider, provider),
            model    = COALESCE(pre_planner_model, model)
      WHERE id = $1`,
    [id],
  );
}

/** Bump a thread's updated_at (e.g. after a new message). */
export async function touchThread(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE threads SET updated_at = datetime('now') WHERE id = $1`,
    [id],
  );
}

export async function deleteThread(id: string): Promise<void> {
  const db = await getDb();
  // Delete children explicitly: SQLite enforces ON DELETE CASCADE only when
  // `PRAGMA foreign_keys = ON`, which is not guaranteed on the plugin's
  // connection, so we don't rely on it.
  await db.execute(
    `DELETE FROM attachments WHERE message_id IN
       (SELECT id FROM messages WHERE thread_id = $1)`,
    [id],
  );
  await db.execute(`DELETE FROM artifacts WHERE thread_id = $1`, [id]);
  await db.execute(`DELETE FROM usage WHERE thread_id = $1`, [id]);
  await db.execute(`DELETE FROM messages WHERE thread_id = $1`, [id]);
  await db.execute(`DELETE FROM threads WHERE id = $1`, [id]);
}

/**
 * Purge all incognito threads (T29): delete every `ephemeral = 1` thread plus
 * its messages, attachments, and usage rows. Children are deleted explicitly,
 * mirroring `deleteThread` (FK CASCADE is not relied upon). The FTS5 index is
 * cleaned automatically: the migration-004 delete triggers fire per deleted
 * message/thread row and remove the matching `search_fts` entries.
 *
 * Called at the START of `init()` (the authoritative, crash-safe purge) and
 * best-effort on window close when close-to-tray is off.
 */
export async function purgeEphemeralThreads(): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM attachments WHERE message_id IN
       (SELECT id FROM messages WHERE thread_id IN
          (SELECT id FROM threads WHERE ephemeral = 1))`,
  );
  await db.execute(
    `DELETE FROM usage WHERE thread_id IN
       (SELECT id FROM threads WHERE ephemeral = 1)`,
  );
  await db.execute(
    `DELETE FROM artifacts WHERE thread_id IN
       (SELECT id FROM threads WHERE ephemeral = 1)`,
  );
  await db.execute(
    `DELETE FROM messages WHERE thread_id IN
       (SELECT id FROM threads WHERE ephemeral = 1)`,
  );
  await db.execute(`DELETE FROM threads WHERE ephemeral = 1`);
}

/** Delete every archived thread (the "clear archive" action), with explicit
 * child deletes mirroring `deleteThread` — FK cascade is not relied upon. */
export async function deleteArchivedThreads(): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM attachments WHERE message_id IN
       (SELECT id FROM messages WHERE thread_id IN
          (SELECT id FROM threads WHERE archived = 1))`,
  );
  await db.execute(
    `DELETE FROM usage WHERE thread_id IN
       (SELECT id FROM threads WHERE archived = 1)`,
  );
  await db.execute(
    `DELETE FROM artifacts WHERE thread_id IN
       (SELECT id FROM threads WHERE archived = 1)`,
  );
  await db.execute(
    `DELETE FROM messages WHERE thread_id IN
       (SELECT id FROM threads WHERE archived = 1)`,
  );
  await db.execute(`DELETE FROM threads WHERE archived = 1`);
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function addMessage(input: {
  thread_id: string;
  role: Role;
  content: string;
  /** 'normal' (default) or 'summary' for a compaction-point row (T28). */
  kind?: MessageKind;
  duration_ms?: number | null;
  /** Persona that authored this reply via an @-mention (T43); null/absent
   * for normal turns. */
  bot_id?: string | null;
  /**
   * Variation group (T54): the group a new variant joins. Pass an existing
   * group id when regenerating to make this reply an alternative of that slot.
   * Omit (undefined) for an ordinary reply — a `normal` assistant turn then
   * becomes its own singleton group (group = own id); other roles/kinds get
   * NULL. Pass `null` explicitly to force a standalone, ungrouped row.
   */
  variant_group?: string | null;
  /** Provider that generated this message (planner/worker attribution). */
  provider?: Provider | null;
  /** Model that generated this message (planner/worker attribution). */
  model?: string | null;
  /** Output type (response-style) active when this reply was generated; shown
   * in the model pill's hover detail. Omit/null for non-assistant rows. */
  output_type?: string | null;
}): Promise<Message> {
  const db = await getDb();
  const id = newId();
  // Default grouping: a fresh assistant chat turn anchors its own group so the
  // regenerate path is uniform; everything else stays ungrouped (NULL).
  const variantGroup =
    input.variant_group !== undefined
      ? input.variant_group
      : input.role === "assistant" && (input.kind ?? "normal") === "normal"
        ? id
        : null;
  await db.execute(
    `INSERT INTO messages (id, thread_id, role, content, kind, duration_ms, bot_id, variant_group, provider, model, output_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      input.thread_id,
      input.role,
      input.content,
      input.kind ?? "normal",
      input.duration_ms ?? null,
      input.bot_id ?? null,
      variantGroup,
      input.provider ?? null,
      input.model ?? null,
      input.output_type ?? null,
    ],
  );
  await touchThread(input.thread_id);
  const rows = await db.select<Message[]>(
    `SELECT * FROM messages WHERE id = $1`,
    [id],
  );
  return rows[0];
}

/**
 * Select one variant of a group as the active one (T54): mark `messageId`
 * selected and deselect its siblings in the same `groupId`. The selected
 * variant is the only one sent as context. Does not bump the thread's
 * updated_at — choosing a variation isn't a new activity.
 */
export async function selectVariant(
  groupId: string,
  messageId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE messages
        SET variant_selected = CASE WHEN id = $1 THEN 1 ELSE 0 END
      WHERE variant_group = $2`,
    [messageId, groupId],
  );
}

export async function listMessages(threadId: string): Promise<Message[]> {
  const db = await getDb();
  return db.select<Message[]>(
    `SELECT * FROM messages WHERE thread_id = $1 ORDER BY created_at ASC`,
    [threadId],
  );
}

/** The latest message of one thread, for the sidebar preview rows (T35). */
export interface LastMessage {
  thread_id: string;
  role: Role;
  content: string;
}

/**
 * Latest **normal** message per thread, in ONE query for the whole visible
 * list (T35 preview rows) — never per-row queries. `kind = 'summary'` rows
 * (T28 compaction points) are skipped: the last real turn is the useful
 * preview, not the synthetic summary. "Latest" is resolved via `MAX(rowid)`
 * (insertion order) because message ids are random UUIDs and `created_at`
 * only has second resolution, so neither orders reliably within a thread.
 * Threads with no messages simply return no row.
 */
export async function lastMessages(
  threadIds: string[],
): Promise<LastMessage[]> {
  if (threadIds.length === 0) return [];
  const db = await getDb();
  const placeholders = threadIds.map((_, i) => `$${i + 1}`).join(", ");
  return db.select<LastMessage[]>(
    `SELECT m.thread_id AS thread_id, m.role AS role, m.content AS content
       FROM messages m
       JOIN (SELECT thread_id, MAX(rowid) AS last_rowid
               FROM messages
              WHERE kind = 'normal' AND variant_selected = 1
              GROUP BY thread_id) latest
         ON m.rowid = latest.last_rowid
      WHERE m.thread_id IN (${placeholders})`,
    threadIds,
  );
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export async function addAttachment(input: {
  message_id: string;
  kind: AttachmentKind;
  media_type: string;
  data: string;
  /** Original file name for `document` rows (T39, migration 012). */
  filename?: string;
}): Promise<Attachment> {
  const db = await getDb();
  const id = newId();
  await db.execute(
    `INSERT INTO attachments (id, message_id, kind, media_type, data, filename)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      input.message_id,
      input.kind,
      input.media_type,
      input.data,
      input.filename ?? null,
    ],
  );
  const rows = await db.select<Attachment[]>(
    `SELECT * FROM attachments WHERE id = $1`,
    [id],
  );
  return rows[0];
}

export async function listAttachments(
  messageId: string,
): Promise<Attachment[]> {
  const db = await getDb();
  return db.select<Attachment[]>(
    `SELECT * FROM attachments WHERE message_id = $1 ORDER BY created_at ASC`,
    [messageId],
  );
}

// ---------------------------------------------------------------------------
// Artifacts (migration 021): multi-file web apps from a ```artifact block
// ---------------------------------------------------------------------------

/** Raw artifacts row — `files` is stored as a JSON string. */
interface ArtifactRow {
  id: string;
  thread_id: string;
  message_id: string;
  ordinal: number;
  title: string;
  files: string;
  created_at: string;
  updated_at: string;
}

function mapArtifact(row: ArtifactRow): Artifact {
  let files: ArtifactFile[] = [];
  try {
    const parsed = JSON.parse(row.files);
    if (Array.isArray(parsed)) files = parsed as ArtifactFile[];
  } catch {
    // Corrupt JSON → treat as empty; the viewer shows "no files".
  }
  return { ...row, files };
}

/**
 * Get the artifact for a `(message_id, ordinal)` slot, creating it from the
 * freshly-parsed block on first encounter. Subsequent calls return the stored
 * record (which may carry in-app edits), so a rendered artifact persists across
 * reloads. Called by the inline card once its message has a real (persisted) id.
 */
export async function ensureArtifact(input: {
  thread_id: string;
  message_id: string;
  ordinal: number;
  title: string;
  files: ArtifactFile[];
}): Promise<Artifact> {
  const db = await getDb();
  const existing = await db.select<ArtifactRow[]>(
    `SELECT * FROM artifacts WHERE message_id = $1 AND ordinal = $2`,
    [input.message_id, input.ordinal],
  );
  if (existing.length > 0) return mapArtifact(existing[0]);

  const id = newId();
  await db.execute(
    `INSERT INTO artifacts (id, thread_id, message_id, ordinal, title, files)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      input.thread_id,
      input.message_id,
      input.ordinal,
      input.title,
      JSON.stringify(input.files),
    ],
  );
  const rows = await db.select<ArtifactRow[]>(
    `SELECT * FROM artifacts WHERE id = $1`,
    [id],
  );
  return mapArtifact(rows[0]);
}

export async function getArtifact(id: string): Promise<Artifact | null> {
  const db = await getDb();
  const rows = await db.select<ArtifactRow[]>(
    `SELECT * FROM artifacts WHERE id = $1`,
    [id],
  );
  return rows.length > 0 ? mapArtifact(rows[0]) : null;
}

/** Persist edited files for an artifact (bumps `updated_at`). */
export async function updateArtifactFiles(
  id: string,
  files: ArtifactFile[],
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE artifacts SET files = $2, updated_at = datetime('now') WHERE id = $1`,
    [id, JSON.stringify(files)],
  );
}

// ---------------------------------------------------------------------------
// Library artifacts (migration 030): saved independent artifact copies
// ---------------------------------------------------------------------------

interface LibraryArtifactRow {
  id: string;
  title: string;
  files: string;
  created_at: string;
  updated_at: string;
}

function mapLibraryArtifact(row: LibraryArtifactRow): LibraryArtifact {
  let files: ArtifactFile[] = [];
  try {
    const parsed = JSON.parse(row.files);
    if (Array.isArray(parsed)) files = parsed as ArtifactFile[];
  } catch {
    // Corrupt JSON → treat as empty; the viewer shows "no files".
  }
  return { ...row, files };
}

export async function saveLibraryArtifact(
  title: string,
  files: ArtifactFile[],
): Promise<LibraryArtifact> {
  const db = await getDb();
  const id = newId();
  // Auto-suffix duplicate titles: "My App", "My App (2)", etc.
  const existing = await db.select<{ title: string }[]>(
    `SELECT title FROM library_artifacts WHERE title = $1 LIMIT 1`,
    [title],
  );
  let finalTitle = title;
  if (existing.length > 0) {
    let n = 2;
    while (true) {
      const candidate = `${title} (${n})`;
      const dups = await db.select<{ title: string }[]>(
        `SELECT title FROM library_artifacts WHERE title = $1 LIMIT 1`,
        [candidate],
      );
      if (dups.length === 0) {
        finalTitle = candidate;
        break;
      }
      n++;
    }
  }
  await db.execute(
    `INSERT INTO library_artifacts (id, title, files)
     VALUES ($1, $2, $3)`,
    [id, finalTitle, JSON.stringify(files)],
  );
  const rows = await db.select<LibraryArtifactRow[]>(
    `SELECT * FROM library_artifacts WHERE id = $1`,
    [id],
  );
  return mapLibraryArtifact(rows[0]);
}

export async function getLibraryArtifact(
  id: string,
): Promise<LibraryArtifact | null> {
  const db = await getDb();
  const rows = await db.select<LibraryArtifactRow[]>(
    `SELECT * FROM library_artifacts WHERE id = $1`,
    [id],
  );
  return rows.length > 0 ? mapLibraryArtifact(rows[0]) : null;
}

export async function listLibraryArtifacts(): Promise<LibraryArtifact[]> {
  const db = await getDb();
  const rows = await db.select<LibraryArtifactRow[]>(
    `SELECT * FROM library_artifacts ORDER BY updated_at DESC`,
  );
  return rows.map(mapLibraryArtifact);
}

export async function updateLibraryArtifactFiles(
  id: string,
  files: ArtifactFile[],
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE library_artifacts SET files = $2, updated_at = datetime('now') WHERE id = $1`,
    [id, JSON.stringify(files)],
  );
}

export async function deleteLibraryArtifact(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM library_artifacts WHERE id = $1`, [id]);
}

export async function renameLibraryArtifact(
  id: string,
  title: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE library_artifacts SET title = $2, updated_at = datetime('now') WHERE id = $1`,
    [id, title],
  );
}

// ---------------------------------------------------------------------------
// Settings (non-secret key/value)
// ---------------------------------------------------------------------------

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    `SELECT value FROM settings WHERE key = $1`,
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

/** Settings key for the per-model max context window map (T53). A JSON object
 * `{ "<model id>": <max tokens> }`; absent/empty = no windows configured. */
export const MODEL_CONTEXT_WINDOWS_KEY = "model_context_windows";

/** Read the per-model max-context-window map (T53). Tolerant of a missing or
 * malformed value (returns `{}`); only finite positive numbers are kept. */
export async function getModelContextWindows(): Promise<
  Record<string, number>
> {
  const raw = await getSetting(MODEL_CONTEXT_WINDOWS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [model, max] of Object.entries(parsed)) {
      if (typeof max === "number" && Number.isFinite(max) && max > 0) {
        out[model] = max;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Persist the per-model max-context-window map (T53). */
export async function setModelContextWindows(
  windows: Record<string, number>,
): Promise<void> {
  await setSetting(MODEL_CONTEXT_WINDOWS_KEY, JSON.stringify(windows));
}

/** Settings key for the deep-research subagent concurrency (T55) — how many
 * subagents run at once. Absent = the backend default. */
export const DEEP_RESEARCH_CONCURRENCY_KEY = "deep_research_concurrency";

/** Upper bound the UI offers, mirroring the backend's `MAX_SUBAGENT_CONCURRENCY`. */
export const MAX_SUBAGENT_CONCURRENCY = 8;

/** Read the configured subagent concurrency, or null when unset (the backend
 * then applies its own default). Tolerant of a missing/malformed value. */
export async function getDeepResearchConcurrency(): Promise<number | null> {
  const raw = await getSetting(DEEP_RESEARCH_CONCURRENCY_KEY);
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(Math.round(n), MAX_SUBAGENT_CONCURRENCY);
}

/** Persist the subagent concurrency (clamped to [1, MAX]). */
export async function setDeepResearchConcurrency(n: number): Promise<void> {
  const clamped = Math.min(
    Math.max(1, Math.round(n)),
    MAX_SUBAGENT_CONCURRENCY,
  );
  await setSetting(DEEP_RESEARCH_CONCURRENCY_KEY, String(clamped));
}

/** Settings keys for the transparency/inspect toggles (Settings → Advanced):
 * capture the model's reasoning, and capture a raw per-round API trace. Both
 * default off (absent = "0") — they add token cost / latency, so opt-in. */
export const CAPTURE_REASONING_KEY = "capture_reasoning";
export const CAPTURE_TRACE_KEY = "capture_api_trace";

async function getBoolSetting(key: string): Promise<boolean> {
  return (await getSetting(key)) === "1";
}
async function setBoolSetting(key: string, on: boolean): Promise<void> {
  await setSetting(key, on ? "1" : "0");
}

/** Whether to capture the model's reasoning/thinking (global, default off). */
export async function getCaptureReasoning(): Promise<boolean> {
  return getBoolSetting(CAPTURE_REASONING_KEY);
}
export async function setCaptureReasoning(on: boolean): Promise<void> {
  await setBoolSetting(CAPTURE_REASONING_KEY, on);
}

/** Whether to capture a raw per-round API request/response trace (default off). */
export async function getCaptureTrace(): Promise<boolean> {
  return getBoolSetting(CAPTURE_TRACE_KEY);
}
export async function setCaptureTrace(on: boolean): Promise<void> {
  await setBoolSetting(CAPTURE_TRACE_KEY, on);
}

/** Settings key for the global quick actions shown on the empty new-chat
 * screen. A JSON array of `QuickAction`; absent = use the built-in defaults. */
export const QUICK_ACTIONS_KEY = "quick_actions";

/** Read the stored global quick-actions JSON, or null when none is saved (the
 * caller seeds the defaults). Parsing/validation lives in `lib/quickActions`. */
export async function getQuickActions(): Promise<string | null> {
  return getSetting(QUICK_ACTIONS_KEY);
}

/** Persist the global quick-actions JSON. */
export async function setQuickActions(json: string): Promise<void> {
  await setSetting(QUICK_ACTIONS_KEY, json);
}

/** Wire protocol a provider speaks. `"openai"` = the shared OpenAI-compatible
 * chat-completions engine (OpenAI, Mistral, Groq, OpenRouter, a local LM
 * Studio/vLLM server, …); `"anthropic"` / `"gemini"` route through the native
 * Rust modules so their non-OpenAI request shapes are preserved. */
export type ProviderProtocol = "openai" | "anthropic" | "gemini";

/** Coerce an arbitrary value to a known protocol, defaulting to `"openai"` (the
 * value for entries stored before the field existed). Pure. */
export function normalizeProtocol(v: unknown): ProviderProtocol {
  return v === "anthropic" || v === "gemini" ? v : "openai";
}

/** A configured provider: an id, a label, the wire protocol, an endpoint base URL
 * (OpenAI-compatible: `{baseUrl}/chat/completions`; anthropic/gemini: the API
 * root the native module appends its path to), and the model new threads default
 * to. Since this refactor, the cloud providers users add from presets are stored
 * here too — the app ships with none. */
export interface CustomProvider {
  id: string;
  label: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  defaultModel: string;
}

/** Settings key for the user-added OpenAI-compatible providers (JSON array). */
export const CUSTOM_PROVIDERS_KEY = "custom_providers";

/** Parse the stored custom-providers JSON. Pure / unit-tested. Tolerant of a
 * missing/malformed value (returns `[]`); only entries with a non-empty `id` and
 * `baseUrl` (and string label/defaultModel) are kept. */
export function parseCustomProviders(raw: string | null): CustomProvider[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: CustomProvider[] = [];
    for (const p of parsed as Record<string, unknown>[]) {
      if (
        p &&
        typeof p.id === "string" &&
        typeof p.baseUrl === "string" &&
        p.id &&
        p.baseUrl &&
        (p.label === undefined || typeof p.label === "string") &&
        (p.defaultModel === undefined || typeof p.defaultModel === "string")
      ) {
        out.push({
          id: p.id,
          label: (p.label as string) || p.id,
          protocol: normalizeProtocol(p.protocol),
          baseUrl: p.baseUrl,
          defaultModel: (p.defaultModel as string) ?? "",
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Read the stored custom providers (see `parseCustomProviders`). */
export async function getCustomProviders(): Promise<CustomProvider[]> {
  return parseCustomProviders(await getSetting(CUSTOM_PROVIDERS_KEY));
}

/** Persist the custom providers list. */
export async function setCustomProviders(
  providers: CustomProvider[],
): Promise<void> {
  await setSetting(CUSTOM_PROVIDERS_KEY, JSON.stringify(providers));
}

// ---------------------------------------------------------------------------
// Workspaces (T20/T58) — grouped threads with shared instructions + reference files
// ---------------------------------------------------------------------------

export async function listWorkspaces(): Promise<Workspace[]> {
  const db = await getDb();
  return db.select<Workspace[]>(
    `SELECT * FROM workspaces ORDER BY updated_at DESC, created_at DESC`,
  );
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  const db = await getDb();
  const rows = await db.select<Workspace[]>(
    `SELECT * FROM workspaces WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function createWorkspace(input: {
  name?: string;
  instructions?: string;
}): Promise<Workspace> {
  const db = await getDb();
  const id = newId();
  await db.execute(
    `INSERT INTO workspaces (id, name, instructions) VALUES ($1, $2, $3)`,
    [id, input.name ?? "New workspace", input.instructions ?? ""],
  );
  const workspace = await getWorkspace(id);
  if (!workspace) throw new Error("Failed to read back created workspace");
  return workspace;
}

export async function renameWorkspace(id: string, name: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE workspaces SET name = $1, updated_at = datetime('now') WHERE id = $2`,
    [name, id],
  );
}

export async function setWorkspaceInstructions(
  id: string,
  instructions: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE workspaces SET instructions = $1, updated_at = datetime('now')
     WHERE id = $2`,
    [instructions, id],
  );
}

/** Persist a workspace's quick-actions override JSON (empty string = no override;
 * the global quick actions then apply). Migration 018. */
export async function setWorkspaceQuickActions(
  id: string,
  quickActions: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE workspaces SET quick_actions = $1, updated_at = datetime('now')
     WHERE id = $2`,
    [quickActions, id],
  );
}

/**
 * Delete a workspace. Its threads are **orphaned to no-workspace** (workspace_id
 * set to NULL), not deleted — chat history is preserved. Workspace files are
 * removed explicitly (we don't rely on FK ON DELETE CASCADE, mirroring
 * deleteThread).
 */
export async function deleteWorkspace(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE threads SET workspace_id = NULL WHERE workspace_id = $1`,
    [id],
  );
  await db.execute(`DELETE FROM workspace_files WHERE workspace_id = $1`, [id]);
  await db.execute(`DELETE FROM workspace_memory WHERE workspace_id = $1`, [
    id,
  ]);
  await db.execute(`DELETE FROM workspaces WHERE id = $1`, [id]);
}

export async function listWorkspaceFiles(
  workspaceId: string,
): Promise<WorkspaceFile[]> {
  const db = await getDb();
  return db.select<WorkspaceFile[]>(
    `SELECT * FROM workspace_files WHERE workspace_id = $1 ORDER BY created_at ASC`,
    [workspaceId],
  );
}

export async function addWorkspaceFile(input: {
  workspace_id: string;
  name: string;
  content: string;
  /** Source URL for URL-ingested files (T59); omit or null for uploaded files. */
  source_url?: string | null;
}): Promise<WorkspaceFile> {
  const db = await getDb();
  const id = newId();
  await db.execute(
    `INSERT INTO workspace_files (id, workspace_id, name, content, source_url)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      id,
      input.workspace_id,
      input.name,
      input.content,
      input.source_url ?? null,
    ],
  );
  await db.execute(
    `UPDATE workspaces SET updated_at = datetime('now') WHERE id = $1`,
    [input.workspace_id],
  );
  const rows = await db.select<WorkspaceFile[]>(
    `SELECT * FROM workspace_files WHERE id = $1`,
    [id],
  );
  return rows[0];
}

export async function deleteWorkspaceFile(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM workspace_files WHERE id = $1`, [id]);
}

// ---------------------------------------------------------------------------
// Workspace memory (T62, migration 025) — per-workspace memory entries,
// mirroring user_memory (005) but scoped to a workspace. Injected into the
// system context when the workspace's memory_enabled flag is 1.
// ---------------------------------------------------------------------------

/** All memory rows for a workspace, oldest first (the order they're injected). */
export async function listWorkspaceMemory(
  workspaceId: string,
): Promise<WorkspaceMemory[]> {
  const db = await getDb();
  return db.select<WorkspaceMemory[]>(
    `SELECT * FROM workspace_memory WHERE workspace_id = $1 ORDER BY created_at ASC`,
    [workspaceId],
  );
}

export async function addWorkspaceMemory(
  workspaceId: string,
  content: string,
): Promise<WorkspaceMemory> {
  const db = await getDb();
  const id = newId();
  await db.execute(
    `INSERT INTO workspace_memory (id, workspace_id, content) VALUES ($1, $2, $3)`,
    [id, workspaceId, content],
  );
  const rows = await db.select<WorkspaceMemory[]>(
    `SELECT * FROM workspace_memory WHERE id = $1`,
    [id],
  );
  return rows[0];
}

export async function updateWorkspaceMemory(
  id: string,
  content: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE workspace_memory SET content = $1, updated_at = datetime('now')
     WHERE id = $2`,
    [content, id],
  );
}

export async function deleteWorkspaceMemory(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM workspace_memory WHERE id = $1`, [id]);
}

/** Toggle workspace memory injection on/off (persists memory_enabled column). */
export async function setWorkspaceMemoryEnabled(
  id: string,
  enabled: boolean,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE workspaces SET memory_enabled = $1, updated_at = datetime('now')
     WHERE id = $2`,
    [enabled ? 1 : 0, id],
  );
}

/** Set the profile and/or cover images for a workspace (T63). Pass null to clear. */
export async function setWorkspaceImages(
  id: string,
  profileImage: string | null,
  coverImage: string | null,
  profileX?: number,
  profileY?: number,
  profileZoom?: number,
  coverX?: number,
  coverY?: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE workspaces SET profile_image = $1, cover_image = $2,
         profile_image_x = $3, profile_image_y = $4, profile_image_zoom = $5,
         cover_image_x = $6, cover_image_y = $7,
         updated_at = datetime('now')
     WHERE id = $8`,
    [
      profileImage,
      coverImage,
      profileX ?? 0.5,
      profileY ?? 0.5,
      profileZoom ?? 1.0,
      coverX ?? 0.5,
      coverY ?? 0.5,
      id,
    ],
  );
}

// ---------------------------------------------------------------------------
// Usage (T16) — per-response token usage, additive
// ---------------------------------------------------------------------------

/** Aggregated usage for a single model, for the usage table view. */
export interface UsageByModel {
  provider: Provider;
  model: string;
  responses: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  /** input + output + cache (creation + read). */
  total_tokens: number;
  /** Most recent usage row's created_at for this model. */
  last_used: string;
}

/** One day's total tokens, for the activity heatmap. */
export interface DailyUsage {
  /** Local "YYYY-MM-DD". */
  day: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  responses: number;
}

/**
 * Persist usage for one assistant response. `model` is the model that actually
 * produced the response (captured from the API), so usage stays attributed to
 * the right model even after a thread's model later changes.
 */
export async function addUsage(input: {
  message_id: string;
  thread_id: string;
  provider: Provider;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO usage (id, message_id, thread_id, provider, model,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      newId(),
      input.message_id,
      input.thread_id,
      input.provider,
      input.model,
      input.input_tokens,
      input.output_tokens,
      input.cache_creation_tokens,
      input.cache_read_tokens,
    ],
  );
}

export interface ThreadUsageTotals {
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  total_tokens: number;
}

/** Summed token usage for one thread (the chat panel's spend number). */
export async function threadUsageTotals(
  threadId: string,
): Promise<ThreadUsageTotals> {
  const db = await getDb();
  const rows = await db.select<
    {
      input_tokens: number | null;
      output_tokens: number | null;
      cache_tokens: number | null;
    }[]
  >(
    `SELECT SUM(input_tokens) AS input_tokens,
            SUM(output_tokens) AS output_tokens,
            SUM(cache_creation_tokens + cache_read_tokens) AS cache_tokens
       FROM usage WHERE thread_id = $1`,
    [threadId],
  );
  const r = rows[0] ?? {};
  const input = r.input_tokens ?? 0;
  const output = r.output_tokens ?? 0;
  const cache = r.cache_tokens ?? 0;
  return {
    input_tokens: input,
    output_tokens: output,
    cache_tokens: cache,
    total_tokens: input + output + cache,
  };
}

/** All usage rows, newest first. */
export async function listUsage(): Promise<Usage[]> {
  const db = await getDb();
  return db.select<Usage[]>(`SELECT * FROM usage ORDER BY created_at DESC`);
}

/** Per-model rollup for the sortable usage table. */
export async function usageByModel(): Promise<UsageByModel[]> {
  const db = await getDb();
  return db.select<UsageByModel[]>(
    `SELECT provider,
            model,
            COUNT(*)                       AS responses,
            SUM(input_tokens)              AS input_tokens,
            SUM(output_tokens)             AS output_tokens,
            SUM(cache_creation_tokens)     AS cache_creation_tokens,
            SUM(cache_read_tokens)         AS cache_read_tokens,
            SUM(input_tokens + output_tokens
                + cache_creation_tokens + cache_read_tokens) AS total_tokens,
            MAX(created_at)                AS last_used
       FROM usage
      GROUP BY provider, model
      ORDER BY total_tokens DESC`,
  );
}

/**
 * Daily totals for the activity heatmap. Buckets by the *local* calendar day:
 * `created_at` is a UTC "YYYY-MM-DD HH:MM:SS" string, so we convert to
 * localtime in SQLite before slicing the date.
 */
export async function dailyUsage(): Promise<DailyUsage[]> {
  const db = await getDb();
  return db.select<DailyUsage[]>(
    `SELECT date(created_at, 'localtime') AS day,
            SUM(input_tokens)                              AS input_tokens,
            SUM(output_tokens)                             AS output_tokens,
            SUM(cache_creation_tokens + cache_read_tokens) AS cache_tokens,
            SUM(input_tokens + output_tokens
                + cache_creation_tokens + cache_read_tokens) AS total_tokens,
            COUNT(*) AS responses
       FROM usage
      GROUP BY day
      ORDER BY day ASC`,
  );
}

// ---------------------------------------------------------------------------
// User memory (T10) — persistent "memory about the user" injected into the
// system context. The custom system-prompt addendum is a single global value
// stored in the `settings` table under SYSTEM_PROMPT_ADDENDUM_KEY (see below).
// ---------------------------------------------------------------------------

/** Settings key for the global custom system-prompt addendum (T10). */
export const SYSTEM_PROMPT_ADDENDUM_KEY = "system_prompt_addendum";

/** All user-memory rows, oldest first (the order they're injected). */
export async function listUserMemory(): Promise<UserMemory[]> {
  const db = await getDb();
  return db.select<UserMemory[]>(
    `SELECT * FROM user_memory ORDER BY created_at ASC`,
  );
}

export async function addUserMemory(content: string): Promise<UserMemory> {
  const db = await getDb();
  const id = newId();
  await db.execute(`INSERT INTO user_memory (id, content) VALUES ($1, $2)`, [
    id,
    content,
  ]);
  const rows = await db.select<UserMemory[]>(
    `SELECT * FROM user_memory WHERE id = $1`,
    [id],
  );
  return rows[0];
}

export async function updateUserMemory(
  id: string,
  content: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE user_memory SET content = $1, updated_at = datetime('now')
     WHERE id = $2`,
    [content, id],
  );
}

export async function deleteUserMemory(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM user_memory WHERE id = $1`, [id]);
}

// ---------------------------------------------------------------------------
// Bots (T38) — user-created personas with avatars and per-bot memory
// ---------------------------------------------------------------------------

/** All bots, alphabetically (case-insensitive), ties broken by creation. */
export async function listBots(): Promise<Bot[]> {
  const db = await getDb();
  return db.select<Bot[]>(
    `SELECT * FROM bots ORDER BY name COLLATE NOCASE, created_at`,
  );
}

export async function getBot(id: string): Promise<Bot | null> {
  const db = await getDb();
  const rows = await db.select<Bot[]>(`SELECT * FROM bots WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function createBot(input?: { name?: string }): Promise<Bot> {
  const db = await getDb();
  const id = newId();
  await db.execute(`INSERT INTO bots (id, name) VALUES ($1, $2)`, [
    id,
    input?.name ?? "New bot",
  ]);
  const bot = await getBot(id);
  if (!bot) throw new Error("Failed to read back created bot");
  return bot;
}

export async function renameBot(id: string, name: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE bots SET name = $1, updated_at = datetime('now') WHERE id = $2`,
    [name, id],
  );
}

export async function setBotInstructions(
  id: string,
  instructions: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE bots SET instructions = $1, updated_at = datetime('now')
     WHERE id = $2`,
    [instructions, id],
  );
}

export async function setBotTagline(
  id: string,
  tagline: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE bots SET tagline = $1, updated_at = datetime('now')
     WHERE id = $2`,
    [tagline, id],
  );
}

/** Persist a persona's conversation starters JSON (migration 019). */
export async function setBotStarters(
  id: string,
  starters: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE bots SET starters = $1, updated_at = datetime('now')
     WHERE id = $2`,
    [starters, id],
  );
}

export async function setBotModusOperandi(
  id: string,
  modusOperandi: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE bots SET modus_operandi = $1, updated_at = datetime('now')
     WHERE id = $2`,
    [modusOperandi, id],
  );
}

export async function setBotToneOfVoice(
  id: string,
  toneOfVoice: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE bots SET tone_of_voice = $1, updated_at = datetime('now')
     WHERE id = $2`,
    [toneOfVoice, id],
  );
}

/** Toggle whether the persona manages its own memory rows (T40). */
export async function setBotAutoMemory(
  id: string,
  enabled: boolean,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE bots SET auto_memory = $1, updated_at = datetime('now')
     WHERE id = $2`,
    [enabled ? 1 : 0, id],
  );
}

/** Toggle whether the persona carries a persistent mood (T40). */
export async function setBotMoodEnabled(
  id: string,
  enabled: boolean,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE bots SET mood_enabled = $1, updated_at = datetime('now')
     WHERE id = $2`,
    [enabled ? 1 : 0, id],
  );
}

/** Set the persona's current mood ("" = neutral / reset) (T40). */
export async function setBotMood(id: string, mood: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE bots SET mood = $1, updated_at = datetime('now')
     WHERE id = $2`,
    [mood, id],
  );
}

/** Set (or clear, with nulls) a bot's uploaded avatar. `data` is base64
 * without a data: prefix; both fields are set or cleared together. */
export async function setBotAvatar(
  id: string,
  mediaType: string | null,
  data: string | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE bots SET avatar_media_type = $1, avatar_data = $2,
            updated_at = datetime('now')
     WHERE id = $3`,
    [mediaType, data, id],
  );
}

/**
 * Set (or clear, with nulls) the default provider+model new chats with this
 * bot inherit. The pair is both-or-neither: a half-set default could not be
 * resolved into a concrete model, so it is normalized to NULL/NULL here.
 */
export async function setBotDefaultModel(
  id: string,
  provider: Provider | null,
  model: string | null,
): Promise<void> {
  const db = await getDb();
  const both = provider !== null && model !== null;
  await db.execute(
    `UPDATE bots SET default_provider = $1, default_model = $2,
            updated_at = datetime('now')
     WHERE id = $3`,
    [both ? provider : null, both ? model : null, id],
  );
}

/**
 * Delete a bot. Its threads are **orphaned to no-bot** (bot_id set to NULL),
 * not deleted — chat history is preserved. Memory rows are removed explicitly
 * (we don't rely on FK ON DELETE CASCADE, mirroring deleteThread).
 */
export async function deleteBot(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE threads SET bot_id = NULL WHERE bot_id = $1`, [id]);
  // Mention-attributed replies (T43) orphan to a normal rendering, mirroring
  // the threads NULL-out above (no FK-cascade reliance).
  await db.execute(`UPDATE messages SET bot_id = NULL WHERE bot_id = $1`, [id]);
  await db.execute(`DELETE FROM bot_memory WHERE bot_id = $1`, [id]);
  await db.execute(`DELETE FROM bots WHERE id = $1`, [id]);
}

/** A bot's memory rows, oldest first (the order they're injected). */
export async function listBotMemory(botId: string): Promise<BotMemory[]> {
  const db = await getDb();
  return db.select<BotMemory[]>(
    `SELECT * FROM bot_memory WHERE bot_id = $1 ORDER BY created_at ASC`,
    [botId],
  );
}

export async function addBotMemory(
  botId: string,
  content: string,
  source: BotMemory["source"] = "user",
): Promise<BotMemory> {
  const db = await getDb();
  const id = newId();
  await db.execute(
    `INSERT INTO bot_memory (id, bot_id, content, source)
     VALUES ($1, $2, $3, $4)`,
    [id, botId, content, source],
  );
  const rows = await db.select<BotMemory[]>(
    `SELECT * FROM bot_memory WHERE id = $1`,
    [id],
  );
  return rows[0];
}

export async function updateBotMemory(
  id: string,
  content: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE bot_memory SET content = $1, updated_at = datetime('now')
     WHERE id = $2`,
    [content, id],
  );
}

export async function deleteBotMemory(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM bot_memory WHERE id = $1`, [id]);
}

// ---------------------------------------------------------------------------
// Search (T19) — full-text search over thread titles + message content
// ---------------------------------------------------------------------------

/** Max search hits returned (the UI groups these by thread). */
const SEARCH_LIMIT = 200;

/**
 * Search chat history (thread titles + message content) for `query`.
 *
 * Primary path: the FTS5 index (`search_fts`, migration 004), ranked by bm25
 * (lower score = more relevant). The query is built safely via `buildFtsMatch`
 * (quoted, prefix-matched terms AND-ed together). We join back to `threads` for
 * the current title and to `messages` for the role/timestamp.
 *
 * Fallback: if the FTS query errors for any reason (e.g. an unexpected SQLite
 * build without FTS5), we fall back to LIKE scans so search still works — just
 * without ranking (score 0). FTS5 is expected to be present (libsqlite3-sys's
 * bundled SQLite enables it), so the fallback is defence-in-depth.
 *
 * Returns a flat, relevance-ordered list; group with `groupHitsByThread`.
 */
export async function searchHistory(query: string): Promise<SearchHit[]> {
  if (searchTerms(query).length === 0) return [];
  const db = await getDb();
  const match = buildFtsMatch(query);

  try {
    return await db.select<SearchHit[]>(
      `SELECT f.kind                                   AS kind,
              f.thread_id                              AS thread_id,
              f.message_id                             AS message_id,
              t.title                                  AS thread_title,
              COALESCE(m.role, 'user')                 AS role,
              f.text                                   AS text,
              COALESCE(m.created_at, t.updated_at)     AS created_at,
              bm25(search_fts)                         AS score
         FROM search_fts f
         JOIN threads t ON t.id = f.thread_id
         LEFT JOIN messages m ON m.id = f.message_id
        WHERE search_fts MATCH $1
        ORDER BY score ASC
        LIMIT $2`,
      [match, SEARCH_LIMIT],
    );
  } catch {
    return searchHistoryLike(db, query);
  }
}

/**
 * LIKE-scan fallback used only if the FTS query errors. AND-s every term across
 * the title/content. No ranking (score 0); ordered newest-first.
 */
async function searchHistoryLike(
  db: Database,
  query: string,
): Promise<SearchHit[]> {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];

  const titleWhere = terms
    .map((_, i) => `t.title LIKE $${i + 1}`)
    .join(" AND ");
  const msgWhere = terms
    .map((_, i) => `m.content LIKE $${i + 1}`)
    .join(" AND ");
  const params = terms.map((t) => `%${t}%`);

  const titleHits = await db.select<SearchHit[]>(
    `SELECT 'title'   AS kind,
            t.id       AS thread_id,
            ''         AS message_id,
            t.title    AS thread_title,
            'user'     AS role,
            t.title    AS text,
            t.updated_at AS created_at,
            0          AS score
       FROM threads t
      WHERE ${titleWhere}
      ORDER BY t.updated_at DESC
      LIMIT $${terms.length + 1}`,
    [...params, SEARCH_LIMIT],
  );

  const messageHits = await db.select<SearchHit[]>(
    `SELECT 'message'  AS kind,
            m.thread_id AS thread_id,
            m.id        AS message_id,
            t.title     AS thread_title,
            m.role      AS role,
            m.content   AS text,
            m.created_at AS created_at,
            0           AS score
       FROM messages m
       JOIN threads t ON t.id = m.thread_id
      WHERE ${msgWhere}
      ORDER BY m.created_at DESC
      LIMIT $${terms.length + 1}`,
    [...params, SEARCH_LIMIT],
  );

  return [...titleHits, ...messageHits].slice(0, SEARCH_LIMIT);
}

// ---------------------------------------------------------------------------
// Models (configurable per-provider model list)
// ---------------------------------------------------------------------------

/** All configured models, ordered by provider then sort_order. */
export async function listModels(): Promise<Model[]> {
  const db = await getDb();
  return db.select<Model[]>(
    `SELECT id, provider, model_id, label, sort_order, notes
       FROM models
      ORDER BY provider, sort_order, label`,
  );
}

/** Add a model for a provider (appended after that provider's current rows). */
export async function addModel(input: {
  provider: Provider;
  modelId: string;
  label: string;
  notes?: string;
}): Promise<void> {
  const db = await getDb();
  // Single statement so the sort_order computation and insert can't race.
  // OR IGNORE makes it idempotent: seeding a provider's default model that
  // already exists (e.g. a canonical-id preset whose model migration 006 seeded)
  // is a silent no-op instead of a UNIQUE(provider, model_id) failure.
  await db.execute(
    `INSERT OR IGNORE INTO models (provider, model_id, label, sort_order, notes)
     SELECT $1, $2, $3, COALESCE(MAX(sort_order), -1) + 1, $5
        FROM models WHERE provider = $4`,
    [
      input.provider,
      input.modelId,
      input.label,
      input.provider,
      input.notes ?? "",
    ],
  );
}

/** Update the notes field for a model. */
export async function updateModelNotes(
  id: number,
  notes: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE models SET notes = $1 WHERE id = $2`, [notes, id]);
}

/** Delete a model by id. */
export async function deleteModel(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM models WHERE id = $1`, [id]);
}
