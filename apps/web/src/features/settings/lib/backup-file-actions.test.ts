import { expect, test } from "bun:test";
import { createBackupFileActions } from "./backup-file-actions";

test("backup native IO preserves save cancellation and releases picked files after merge or failure", async () => {
  const bytes = new TextEncoder().encode('{"title":"中文"}');
  let saved = false, cancelled = false, disposed = 0, merges = 0, broken = false;
  const counts = { books: 1, collections: 0, annotations: 0, settings: 0 };
  const actions = createBackupFileActions({ serialize: async () => "PRIVATE BACKUP",
    save: async json => { expect(json).toBe("PRIVATE BACKUP"); return saved; },
    merge: async json => { merges++; expect(json).toBe('{"title":"中文"}'); if (broken) throw Error("merge failed"); return counts; },
    reader: () => ({
      pick: async options => { expect(options).toEqual({ multiple: false, extensions: ["json"] }); return { cancelled,
        resources: cancelled ? [] : [{ id: "private", size: bytes.length } as never] }; },
      read: async (_id, offset) => {
        const nextOffset = Math.min(offset + 2, bytes.length);
        return { data: bytes.slice(offset, nextOffset).buffer, nextOffset, eof: nextOffset === bytes.length };
      },
      dispose: async () => { disposed++; },
    }),
  });
  expect(await actions.export()).toBe(false); saved = true; expect(await actions.export()).toBe(true);
  cancelled = true; expect(await actions.import()).toBeNull(); expect(merges).toBe(0); expect(disposed).toBe(1);
  cancelled = false; expect(await actions.import()).toEqual(counts); expect(disposed).toBe(2);
  broken = true; await expect(actions.import()).rejects.toThrow("merge failed"); expect(disposed).toBe(3);
});

test("cancellation stops preparation but cannot interrupt an already-started v1 merge", async () => {
  const controller = new AbortController(); let merges = 0, disposed = 0;
  const serializing = Promise.withResolvers<string>();
  const actions = createBackupFileActions({ serialize: () => serializing.promise, save: async () => { throw Error("Must not save"); },
    merge: async () => { merges++; controller.abort(); return { books: 0, collections: 0, annotations: 0, settings: 0 }; },
    reader: () => ({ pick: async () => ({ cancelled: false, resources: [{ id: "private", size: 2 } as never] }),
      read: async () => ({ data: new TextEncoder().encode("{}").slice().buffer, nextOffset: 2, eof: true }), dispose: async () => { disposed++; } }),
  });
  const exported = actions.export(controller.signal).catch(error => error);
  expect(await actions.import(controller.signal)).toMatchObject({ books: 0 });
  serializing.resolve("private"); expect(await exported).toBeInstanceOf(Error);
  expect(merges).toBe(1); expect(disposed).toBe(1);
  await expect(actions.import(controller.signal)).rejects.toThrow(); expect(merges).toBe(1);
});
