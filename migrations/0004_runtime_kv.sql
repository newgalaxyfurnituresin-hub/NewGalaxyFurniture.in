-- Small private runtime records use the existing D1 database instead of Workers KV's
-- 1,000 daily free writes. Namespace isolation, expiry and existing auth remain intact.
CREATE TABLE IF NOT EXISTS runtime_kv (
  namespace TEXT NOT NULL,
  entry_key TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER,
  PRIMARY KEY (namespace, entry_key)
) WITHOUT ROWID;
