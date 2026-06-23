-- Scoped key-value storage for runtime plugins (gated by the "storage"
-- permission). Namespaced by plugin_id; values are opaque strings (plugins
-- serialize their own JSON). Rows are not cascaded on uninstall — uninstalling
-- a plugin removes its folder but intentionally leaves its data, so a reinstall
-- can resume. (Add explicit cleanup later if orphaned rows ever matter.)
CREATE TABLE IF NOT EXISTS plugin_storage (
  plugin_id TEXT NOT NULL,
  key       TEXT NOT NULL,
  value     TEXT NOT NULL,
  PRIMARY KEY (plugin_id, key)
);
