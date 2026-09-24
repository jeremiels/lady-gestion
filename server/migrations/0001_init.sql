-- One row per subscribed device: its push keys and its whole reminder list,
-- replaced as one value by every PUT /reminders. next_fire_at is the list's
-- soonest fireAt (NULL when empty), so the cron reads only rows with work due.
CREATE TABLE subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  reminders TEXT NOT NULL,
  next_fire_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX subscriptions_next_fire_at ON subscriptions (next_fire_at);
