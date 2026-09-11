CREATE TABLE user_profile (
    id TEXT PRIMARY KEY CHECK (id = 'local'),
    display_name TEXT,
    summary TEXT,
    traits_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_event_id TEXT NOT NULL
);
CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_event_id TEXT NOT NULL
);
CREATE INDEX ix_entities_kind_name ON entities(kind, canonical_name, id);
CREATE TABLE entity_aliases (
    entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (entity_id, alias)
);
CREATE INDEX ix_entity_aliases_name ON entity_aliases(alias, entity_id);
CREATE TABLE entity_redirects (
    merged_id TEXT PRIMARY KEY,
    keep_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_event_id TEXT NOT NULL,
    CHECK (merged_id != keep_id)
);
CREATE INDEX ix_entity_redirects_keep ON entity_redirects(keep_id, merged_id);
