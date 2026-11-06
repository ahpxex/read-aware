-- Device-local recovery state, never a synced projection or plugin-owned KV.
CREATE TABLE plugin_update_journal (
    update_id TEXT PRIMARY KEY,
    plugin_id TEXT NOT NULL UNIQUE,
    candidate_token TEXT,
    had_previous INTEGER CHECK(had_previous IN (0, 1)),
    baseline_json TEXT NOT NULL,
    phase TEXT NOT NULL CHECK(phase IN ('prepared', 'accepted')),
    accepted_json TEXT,
    CHECK((phase='prepared' AND accepted_json IS NULL) OR (phase='accepted' AND accepted_json IS NOT NULL)),
    CHECK((candidate_token IS NULL AND had_previous IS NULL) OR (candidate_token IS NOT NULL AND had_previous IS NOT NULL))
);
