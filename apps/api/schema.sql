-- AI usage counters for the phase-1 quota gate. Run once against the D1
-- database bound as "DB" in wrangler.toml:
--   npx wrangler d1 execute lifeflow-usage --remote --file apps/api/schema.sql
CREATE TABLE IF NOT EXISTS ai_usage (
  device_id TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, day)
);

-- Phase-2 accounts: email login binds the quota identity and later paid
-- plans to a stable user instead of a device.
-- plan: 'free' | 'monthly' | 'yearly'; plan_expires_at gates the paid tiers.
-- For databases created before phase 3, add the columns manually:
--   ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
--   ALTER TABLE users ADD COLUMN plan_expires_at TEXT;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  plan_expires_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
