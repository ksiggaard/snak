import Database from "@tauri-apps/plugin-sql";
import { buildFtsMatch, searchTerms } from "@/lib/search";
import type {
  Attachment,
  AttachmentKind,
  Message,
  Model,
  Project,
  ProjectFile,
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

/** Lazily open (once) and reuse the SQLite connection. */
export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load(DB_URL);
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
  /** Optional project to create the thread inside. */
  projectId?: string | null;
}): Promise<Thread> {
  const db = await getDb();
  const id = newId();
  await db.execute(
    `INSERT INTO threads (id, title, provider, model, project_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      id,
      input.title ?? "New chat",
      input.provider,
      input.model,
      input.projectId ?? null,
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

/** Assign (or clear, with null) the project a thread belongs to. */
export async function setThreadProject(
  id: string,
  projectId: string | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE threads SET project_id = $1, updated_at = datetime('now')
     WHERE id = $2`,
    [projectId, id],
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
  await db.execute(`DELETE FROM usage WHERE thread_id = $1`, [id]);
  await db.execute(`DELETE FROM messages WHERE thread_id = $1`, [id]);
  await db.execute(`DELETE FROM threads WHERE id = $1`, [id]);
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function addMessage(input: {
  thread_id: string;
  role: Role;
  content: string;
}): Promise<Message> {
  const db = await getDb();
  const id = newId();
  await db.execute(
    `INSERT INTO messages (id, thread_id, role, content)
     VALUES ($1, $2, $3, $4)`,
    [id, input.thread_id, input.role, input.content],
  );
  await touchThread(input.thread_id);
  const rows = await db.select<Message[]>(
    `SELECT * FROM messages WHERE id = $1`,
    [id],
  );
  return rows[0];
}

export async function listMessages(threadId: string): Promise<Message[]> {
  const db = await getDb();
  return db.select<Message[]>(
    `SELECT * FROM messages WHERE thread_id = $1 ORDER BY created_at ASC`,
    [threadId],
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
}): Promise<Attachment> {
  const db = await getDb();
  const id = newId();
  await db.execute(
    `INSERT INTO attachments (id, message_id, kind, media_type, data)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, input.message_id, input.kind, input.media_type, input.data],
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

// ---------------------------------------------------------------------------
// Projects (T20) — grouped threads with shared instructions + reference files
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<Project[]> {
  const db = await getDb();
  return db.select<Project[]>(
    `SELECT * FROM projects ORDER BY updated_at DESC, created_at DESC`,
  );
}

export async function getProject(id: string): Promise<Project | null> {
  const db = await getDb();
  const rows = await db.select<Project[]>(
    `SELECT * FROM projects WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function createProject(input: {
  name?: string;
  instructions?: string;
}): Promise<Project> {
  const db = await getDb();
  const id = newId();
  await db.execute(
    `INSERT INTO projects (id, name, instructions) VALUES ($1, $2, $3)`,
    [id, input.name ?? "New project", input.instructions ?? ""],
  );
  const project = await getProject(id);
  if (!project) throw new Error("Failed to read back created project");
  return project;
}

export async function renameProject(id: string, name: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE projects SET name = $1, updated_at = datetime('now') WHERE id = $2`,
    [name, id],
  );
}

export async function setProjectInstructions(
  id: string,
  instructions: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE projects SET instructions = $1, updated_at = datetime('now')
     WHERE id = $2`,
    [instructions, id],
  );
}

/**
 * Delete a project. Its threads are **orphaned to no-project** (project_id set
 * to NULL), not deleted — chat history is preserved. Project files are removed
 * explicitly (we don't rely on FK ON DELETE CASCADE, mirroring deleteThread).
 */
export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE threads SET project_id = NULL WHERE project_id = $1`,
    [id],
  );
  await db.execute(`DELETE FROM project_files WHERE project_id = $1`, [id]);
  await db.execute(`DELETE FROM projects WHERE id = $1`, [id]);
}

export async function listProjectFiles(
  projectId: string,
): Promise<ProjectFile[]> {
  const db = await getDb();
  return db.select<ProjectFile[]>(
    `SELECT * FROM project_files WHERE project_id = $1 ORDER BY created_at ASC`,
    [projectId],
  );
}

export async function addProjectFile(input: {
  project_id: string;
  name: string;
  content: string;
}): Promise<ProjectFile> {
  const db = await getDb();
  const id = newId();
  await db.execute(
    `INSERT INTO project_files (id, project_id, name, content)
     VALUES ($1, $2, $3, $4)`,
    [id, input.project_id, input.name, input.content],
  );
  await db.execute(
    `UPDATE projects SET updated_at = datetime('now') WHERE id = $1`,
    [input.project_id],
  );
  const rows = await db.select<ProjectFile[]>(
    `SELECT * FROM project_files WHERE id = $1`,
    [id],
  );
  return rows[0];
}

export async function deleteProjectFile(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM project_files WHERE id = $1`, [id]);
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

  const titleWhere = terms.map((_, i) => `t.title LIKE $${i + 1}`).join(" AND ");
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
    `SELECT id, provider, model_id, label, sort_order
       FROM models
      ORDER BY provider, sort_order, label`,
  );
}

/** Add a model for a provider (appended after that provider's current rows). */
export async function addModel(input: {
  provider: Provider;
  modelId: string;
  label: string;
}): Promise<void> {
  const db = await getDb();
  // Single statement so the sort_order computation and insert can't race.
  await db.execute(
    `INSERT INTO models (provider, model_id, label, sort_order)
     SELECT $1, $2, $3, COALESCE(MAX(sort_order), -1) + 1
       FROM models WHERE provider = $4`,
    [input.provider, input.modelId, input.label, input.provider],
  );
}

/** Delete a model by id. */
export async function deleteModel(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM models WHERE id = $1`, [id]);
}
