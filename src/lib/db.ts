import Database from "@tauri-apps/plugin-sql";
import type {
  Attachment,
  AttachmentKind,
  Message,
  Provider,
  Role,
  Thread,
} from "@/types/db";

// Must match `DB_URL` in src-tauri/src/lib.rs. Migrations are run by the
// backend on startup; here we just connect.
const DB_URL = "sqlite:kde-llm.db";

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
}): Promise<Thread> {
  const db = await getDb();
  const id = newId();
  await db.execute(
    `INSERT INTO threads (id, title, provider, model)
     VALUES ($1, $2, $3, $4)`,
    [id, input.title ?? "New chat", input.provider, input.model],
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
