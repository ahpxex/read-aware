ALTER TABLE identity_consolidation_work RENAME TO identity_work_v39;
CREATE TABLE identity_consolidation_work (
    id INTEGER PRIMARY KEY CHECK(id=1), revision TEXT NOT NULL,
    page_count INTEGER NOT NULL CHECK(page_count BETWEEN 0 AND 9007199254740991),
    base_index INTEGER NOT NULL DEFAULT 0 CHECK(base_index BETWEEN 0 AND page_count),
    checkpoint TEXT,
    CHECK(page_count - base_index <= 4096)
);
INSERT INTO identity_consolidation_work(id, revision, page_count)
    SELECT id, revision, page_count FROM identity_work_v39;
DROP TABLE identity_work_v39;
ALTER TABLE identity_consolidation_pages RENAME TO identity_pages_v39;
CREATE TABLE identity_consolidation_pages (
    page_index INTEGER PRIMARY KEY CHECK(page_index BETWEEN 0 AND 9007199254740990), json TEXT NOT NULL
);
INSERT INTO identity_consolidation_pages SELECT * FROM identity_pages_v39;
DROP TABLE identity_pages_v39;
