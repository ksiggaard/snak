// Per-plugin scoped key-value storage (the `storage` capability on PluginContext).
// Backed by the app's SQLite `plugin_storage` table (migration 031), namespaced
// by plugin id. Plugins serialize their own structured data into the string value.

import { getDb } from "@/lib/db";
import type { KVStore } from "@/types/pluginApi";

export function pluginStorage(pluginId: string): KVStore {
  return {
    async get(key) {
      const db = await getDb();
      const rows = await db.select<{ value: string }[]>(
        `SELECT value FROM plugin_storage WHERE plugin_id = $1 AND key = $2`,
        [pluginId, key],
      );
      return rows[0]?.value ?? null;
    },
    async set(key, value) {
      const db = await getDb();
      await db.execute(
        `INSERT INTO plugin_storage (plugin_id, key, value) VALUES ($1, $2, $3)
         ON CONFLICT (plugin_id, key) DO UPDATE SET value = excluded.value`,
        [pluginId, key, value],
      );
    },
    async delete(key) {
      const db = await getDb();
      await db.execute(
        `DELETE FROM plugin_storage WHERE plugin_id = $1 AND key = $2`,
        [pluginId, key],
      );
    },
    async keys() {
      const db = await getDb();
      const rows = await db.select<{ key: string }[]>(
        `SELECT key FROM plugin_storage WHERE plugin_id = $1 ORDER BY key`,
        [pluginId],
      );
      return rows.map((r) => r.key);
    },
  };
}
