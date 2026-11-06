ALTER TABLE plugin_documents ADD COLUMN revision TEXT NOT NULL DEFAULT '';
UPDATE plugin_documents SET revision = lower(hex(randomblob(16)));
CREATE TABLE plugin_document_generations (
    plugin_id TEXT NOT NULL,
    collection TEXT NOT NULL,
    generation TEXT NOT NULL,
    PRIMARY KEY (plugin_id, collection)
);
INSERT INTO plugin_document_generations
SELECT plugin_id, collection, lower(hex(randomblob(16)))
FROM plugin_documents GROUP BY plugin_id, collection;

-- All writers, including legacy writes and rollback restores, rotate identities.
-- The internal revision-only UPDATE cannot retrigger the content UPDATE trigger.
CREATE TRIGGER plugin_documents_insert_revision AFTER INSERT ON plugin_documents BEGIN
    UPDATE plugin_documents SET revision = lower(hex(randomblob(16)))
    WHERE plugin_id = new.plugin_id AND collection = new.collection AND id = new.id;
    INSERT INTO plugin_document_generations VALUES (new.plugin_id, new.collection, lower(hex(randomblob(16))))
    ON CONFLICT(plugin_id, collection) DO UPDATE SET generation = excluded.generation;
END;
CREATE TRIGGER plugin_documents_update_revision
AFTER UPDATE OF json, book_id, anchor, updated_at ON plugin_documents BEGIN
    UPDATE plugin_documents SET revision = lower(hex(randomblob(16)))
    WHERE plugin_id = new.plugin_id AND collection = new.collection AND id = new.id;
    INSERT INTO plugin_document_generations VALUES (new.plugin_id, new.collection, lower(hex(randomblob(16))))
    ON CONFLICT(plugin_id, collection) DO UPDATE SET generation = excluded.generation;
END;
CREATE TRIGGER plugin_documents_delete_revision AFTER DELETE ON plugin_documents BEGIN
    INSERT INTO plugin_document_generations VALUES (old.plugin_id, old.collection, lower(hex(randomblob(16))))
    ON CONFLICT(plugin_id, collection) DO UPDATE SET generation = excluded.generation;
END;
CREATE INDEX ix_plugin_documents_page ON plugin_documents(plugin_id, collection, updated_at, id);
CREATE INDEX ix_plugin_documents_book_page ON plugin_documents(plugin_id, collection, book_id, updated_at, id);
