-- Web Push subscriptions. One row per browser PushSubscription, keyed by its
-- (globally-unique) endpoint URL. `p256dh` + `auth` are the RFC 8291 keys the
-- `web-push` library needs to encrypt a payload for this subscriber.
CREATE TABLE IF NOT EXISTS subscriptions (
  endpoint        TEXT PRIMARY KEY,
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  expiration_time INTEGER,
  -- Optional: the wallet identity fingerprint (hex) this subscription belongs
  -- to, so a settlement push can target the right subscriber. NULL = broadcast.
  fingerprint     TEXT,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_fingerprint ON subscriptions (fingerprint);
