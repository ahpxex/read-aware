-- Published projection checkpoints (docs/sync-engine.md §13). One row per
-- (account, client schema version): the `snapshot:` blob a device cut from a
-- mailbox-exact log, and the mailbox frontier it covers. The relay reads
-- nothing inside the blob — it stores a key and some integers so a new device
-- can restore the shelf in one download and pull only the tail.
CREATE TABLE IF NOT EXISTS account_snapshots (
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL,
  blob_key       TEXT NOT NULL,
  frontier_seq   INTEGER NOT NULL,
  byte_size      INTEGER NOT NULL,
  device_id      TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  PRIMARY KEY (account_id, schema_version)
);
