// In-memory stand-in for the SQLite layer, used only in WEB_ONLY mode so the app
// runs in a plain browser with no tauri-plugin-sql backend. It implements the
// `select`/`execute` surface lib/db.ts uses via substring-dispatch over the
// queries the app actually runs — NOT a SQL engine, but enough that the core
// loop (list/switch/create/rename/delete threads, send messages, settings) works
// and PERSISTS to localStorage across reloads. The demo thread is seeded only on
// first run; after that the stored state wins. Clear the `snak-webdb` localStorage
// key to reset.
import type Database from "@tauri-apps/plugin-sql";

export const WEB_THREAD_ID = "web-debug-thread";
const LS_KEY = "snak-webdb-v1";

type Row = Record<string, unknown>;
interface DbState {
  threads: Row[];
  messages: Row[];
  settings: Record<string, string>;
  models: Row[];
}

function sqlNow(offsetSec = 0): string {
  return new Date(Date.now() + offsetSec * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

// Default rows from migration 006_models.sql so the model picker shows real
// models (and the seeded thread's model resolves).
const SEED_MODELS: Row[] = [
  { id: 1, provider: "anthropic", model_id: "claude-opus-4-8", label: "Opus 4.8", sort_order: 0, notes: "" },
  { id: 2, provider: "anthropic", model_id: "claude-sonnet-4-6", label: "Sonnet 4.6", sort_order: 1, notes: "" },
  { id: 3, provider: "anthropic", model_id: "claude-haiku-4-5", label: "Haiku 4.5", sort_order: 2, notes: "" },
  { id: 4, provider: "openai", model_id: "gpt-4o", label: "GPT-4o", sort_order: 0, notes: "" },
  { id: 5, provider: "mistral", model_id: "mistral-large-latest", label: "Mistral Large", sort_order: 0, notes: "" },
  { id: 6, provider: "gemini", model_id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", sort_order: 0, notes: "" },
];

const LOREM =
  "This is a seeded assistant reply used to give the web-only demo thread some " +
  "realistic height — a few sentences so the row is tall enough that a dozen of " +
  "them overflow the viewport and the thread actually scrolls.";

function seed(): DbState {
  const threads: Row[] = [
    {
      id: WEB_THREAD_ID,
      title: "Web debug thread",
      provider: "anthropic",
      model: "claude-opus-4-8",
      workspace_id: null,
      ephemeral: 0,
      bot_id: null,
      favorite: 0,
      archived: 0,
      deep_research: 0,
      output_type: "default",
      planner_active: 0,
      pre_planner_provider: null,
      pre_planner_model: null,
      workspace_files_excluded: null,
      created_at: sqlNow(-3600),
      updated_at: sqlNow(-3600),
    },
  ];
  const messages: Row[] = [];
  for (let i = 0; i < 12; i++) {
    const role = i % 2 === 0 ? "user" : "assistant";
    const content =
      role === "user"
        ? `Seed question #${i / 2 + 1} — tell me more.`
        : `${LOREM}\n\n${LOREM}\n\nParagraph three of reply ${(i - 1) / 2 + 1}.`;
    messages.push({
      id: `web-msg-${i}`,
      thread_id: WEB_THREAD_ID,
      role,
      content,
      kind: "normal",
      duration_ms: role === "assistant" ? 1200 : null,
      bot_id: null,
      variant_group: role === "assistant" ? `web-msg-${i}` : null,
      variant_selected: 1,
      provider: role === "assistant" ? "anthropic" : null,
      model: role === "assistant" ? "claude-opus-4-8" : null,
      output_type: role === "assistant" ? "default" : null,
      reasoning: null,
      created_at: sqlNow(-3600 + i * 10),
    });
  }
  return { threads, messages, settings: { last_thread_id: WEB_THREAD_ID }, models: SEED_MODELS };
}

function load(): DbState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<DbState>;
      if (s && Array.isArray(s.threads) && Array.isArray(s.messages)) {
        return {
          threads: s.threads,
          messages: s.messages,
          settings: s.settings ?? {},
          // Models aren't mutated by the app — always use the current seed list.
          models: SEED_MODELS,
        };
      }
    }
  } catch {
    // Corrupt/unavailable storage → fall back to a fresh seed.
  }
  return seed();
}

const state = load();
function save(): void {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ threads: state.threads, messages: state.messages, settings: state.settings }),
    );
  } catch {
    // Over quota / disabled storage — keep working in-memory for this session.
  }
}

function select(query: string, values: unknown[] = []): Row[] {
  const q = query.toLowerCase();
  if (q.includes(" from threads")) {
    return q.includes("where id")
      ? state.threads.filter((t) => t.id === values[0])
      : state.threads;
  }
  if (q.includes(" from messages")) {
    if (q.includes("where id")) return state.messages.filter((m) => m.id === values[0]);
    if (q.includes("where thread_id"))
      return state.messages.filter((m) => m.thread_id === values[0]);
    return state.messages;
  }
  if (q.includes(" from settings")) {
    const v = state.settings[values[0] as string];
    return v === undefined ? [] : [{ value: v }];
  }
  if (q.includes(" from models")) return state.models;
  // Bots / workspaces / memory / usage / attachments / artifacts / FTS: nothing
  // seeded → empty, which every caller tolerates (default/empty states).
  return [];
}

function execute(query: string, values: unknown[] = []): void {
  const q = query.toLowerCase().trimStart();

  if (q.startsWith("insert into messages")) {
    // Column order mirrors lib/db.ts addMessage().
    const [id, thread_id, role, content, kind, duration_ms, bot_id, variant_group, provider, model, output_type] =
      values;
    state.messages.push({
      id, thread_id, role, content, kind,
      duration_ms, bot_id, variant_group, variant_selected: 1,
      provider, model, output_type, reasoning: null, created_at: sqlNow(),
    });
  } else if (q.startsWith("insert into threads")) {
    // Column order mirrors lib/db.ts createThread().
    const [id, title, provider, model, workspace_id, ephemeral, bot_id] = values;
    state.threads.unshift({
      id, title, provider, model, workspace_id, ephemeral, bot_id,
      favorite: 0, archived: 0, deep_research: 0, output_type: "default",
      planner_active: 0, pre_planner_provider: null, pre_planner_model: null,
      workspace_files_excluded: null, created_at: sqlNow(), updated_at: sqlNow(),
    });
  } else if (q.includes("into settings")) {
    state.settings[values[0] as string] = values[1] as string;
  } else if (q.startsWith("update threads")) {
    // The id parameter is always last in these statements.
    const t = state.threads.find((t) => t.id === values[values.length - 1]);
    if (t) {
      if (q.includes("set title")) t.title = values[0];
      else if (q.includes("provider =") && q.includes("model ="))
        Object.assign(t, { provider: values[0], model: values[1] });
      else if (q.includes("favorite =")) t.favorite = values[0];
      else if (q.includes("archived =")) t.archived = values[0];
      else if (q.includes("ephemeral =")) t.ephemeral = values[0];
      else if (q.includes("bot_id =")) t.bot_id = values[0];
      if (q.includes("updated_at")) t.updated_at = sqlNow();
    }
  } else if (q.startsWith("delete from messages")) {
    // deleteThread: WHERE thread_id = $1.
    state.messages = state.messages.filter((m) => m.thread_id !== values[0]);
  } else if (q.startsWith("delete from threads")) {
    state.threads = state.threads.filter((t) => t.id !== values[0]);
  }
  // Other writes (attachments/usage/artifacts/bots/workspaces) are no-ops in web
  // mode — not needed for the chat loop.
  save();
}

// Cast to the plugin's Database type: lib/db.ts only ever calls select/execute.
export const webDb = {
  async select<T>(query: string, values?: unknown[]): Promise<T> {
    return select(query, values) as unknown as T;
  },
  async execute(query: string, values?: unknown[]) {
    execute(query, values);
    return { rowsAffected: 1, lastInsertId: 0 };
  },
} as unknown as Database;
