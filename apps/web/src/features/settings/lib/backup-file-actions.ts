import { AppError, RESOURCE_MAX_CHUNK, type ResourcePort } from "@read-aware/core";
import { exportTextFile } from "../../../platform/export-file";
import { createResourceOwner } from "../../../services/resources";
import { exportBackup, importBackup, type BackupImportResult } from "./backup-io";

export const BACKUP_FILENAME = "readaware-backup.json";
type Reader = Pick<ResourcePort, "pick" | "read"> & { dispose(): Promise<void> };
type Dependencies = {
  serialize(): Promise<string>;
  merge(json: string): Promise<BackupImportResult>;
  save(json: string, signal?: AbortSignal): Promise<boolean>;
  reader(): Reader;
};

/** Native file selection/saving stays host-owned; actors receive no backup bytes. */
export function createBackupFileActions(deps: Dependencies) {
  return {
    async export(signal?: AbortSignal): Promise<boolean> {
      signal?.throwIfAborted();
      const json = await deps.serialize();
      signal?.throwIfAborted();
      return deps.save(json, signal);
    },
    async import(signal?: AbortSignal): Promise<BackupImportResult | null> {
      signal?.throwIfAborted();
      const reader = deps.reader();
      try {
        const picked = await reader.pick({ multiple: false, extensions: ["json"] }, signal);
        signal?.throwIfAborted();
        if (picked.cancelled || !picked.resources.length) return null;
        const file = picked.resources[0]!;
        const decoder = new TextDecoder("utf-8", { fatal: true }), parts: string[] = [];
        let offset = 0;
        while (offset < file.size) {
          signal?.throwIfAborted();
          const chunk = await reader.read(file.id, offset, RESOURCE_MAX_CHUNK, signal);
          if (chunk.nextOffset <= offset || chunk.nextOffset > file.size || chunk.data.byteLength !== chunk.nextOffset - offset
            || chunk.eof !== (chunk.nextOffset === file.size)) throw new AppError("ui/unavailable", "Incomplete backup file read");
          parts.push(decoder.decode(chunk.data, { stream: true }));
          offset = chunk.nextOffset;
          if (chunk.eof) break;
        }
        parts.push(decoder.decode());
        signal?.throwIfAborted();
        // The existing v1 merge is not transactional. Once begun, finish its
        // writes rather than treating cancellation as a rollback.
        return await deps.merge(parts.join(""));
      } finally { await reader.dispose(); }
    },
  };
}

export const backupFileActions = createBackupFileActions({
  serialize: exportBackup,
  merge: importBackup,
  save: (content, signal) => exportTextFile({ filename: BACKUP_FILENAME, content, mimeType: "application/json" }, signal),
  reader: createResourceOwner,
});
