-- Device-local restore obligations, never copied from another device or rebuilt
-- from projections. No credential values: publication reads the current local
-- secret, so a later user edit supersedes the restored value (including delete).
CREATE TABLE restored_credential_publications (
    slot TEXT PRIMARY KEY NOT NULL,
    created_at TEXT NOT NULL
);
