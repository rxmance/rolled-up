CREATE TABLE IF NOT EXISTS ownership_cache (
  cache_key TEXT PRIMARY KEY,
  business_name TEXT NOT NULL,
  location_key TEXT,
  result_json TEXT NOT NULL,
  researched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ownership_cache_expires_idx
ON ownership_cache (expires_at);
