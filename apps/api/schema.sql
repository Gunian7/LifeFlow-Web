-- AI usage counters for the phase-1 quota gate. Run once against the D1
-- database bound as "DB" in wrangler.toml:
--   npx wrangler d1 execute lifeflow-usage --remote --file apps/api/schema.sql
CREATE TABLE IF NOT EXISTS ai_usage (
  device_id TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, day)
);
