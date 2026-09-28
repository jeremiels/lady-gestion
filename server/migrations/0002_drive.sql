-- Google Drive sign-in (src/drive-auth.ts). Refresh tokens are AES-GCM
-- sealed with a key derived from DRIVE_SECRET; session tokens are stored only
-- as their SHA-256.

-- A finished sign-in waiting for the app to claim it, keyed by the SHA-256 of
-- the app's claim secret. Deleted by the claim, or by the cron once expired.
CREATE TABLE drive_claims (
  claim_hash TEXT PRIMARY KEY,
  refresh_token TEXT NOT NULL,
  email TEXT NOT NULL,
  scope TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- One row per signed-in device.
CREATE TABLE drive_sessions (
  id TEXT PRIMARY KEY,
  refresh_token TEXT NOT NULL,
  email TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
