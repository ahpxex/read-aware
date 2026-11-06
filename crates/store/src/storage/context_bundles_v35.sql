CREATE TABLE context_bundles (
    version TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    scope_kind TEXT NOT NULL,
    scope_id TEXT,
    content_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_event_id TEXT NOT NULL
);
CREATE INDEX ix_context_bundles_history ON context_bundles(kind, scope_kind, scope_id, created_at, version);
CREATE TABLE context_bundle_items (
    bundle_version TEXT NOT NULL REFERENCES context_bundles(version) ON DELETE CASCADE,
    rank INTEGER NOT NULL CHECK (rank >= 0),
    source_kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_revision TEXT NOT NULL,
    PRIMARY KEY (bundle_version, rank)
);
