import { afterEach, expect, spyOn, test } from "bun:test";
import { AppError, BOOK_IMPORT_FORMATS, RESOURCE_MAX_CHUNK } from "@read-aware/core";
import * as parser from "../features/reader/lib/parse-book";
import { formatFromName } from "../features/library/lib/import-format";
import { ResourceOwner } from "../services/resource-owner";
import { resourceAdapter } from "../services/resources";
import { nativeResourceFiles } from "../platform/resource-files";
import { resourceBookFile } from "../platform/resource-book-file";
import { inspectResourceBook, listBookFormats } from "./book-inspection";

const restore: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of restore.splice(0).reverse()) await cleanup(); });
async function fixture() {
  let destroyed = 0;
  const owner = new ResourceOwner({ ...resourceAdapter, pick: async () => [{ id: "native", name: "book.epub", mimeType: "application/epub+zip", size: 8 }],
    release: async () => {} }, () => {});
  const ref = (await owner.pick()).resources[0]!;
  const parse = spyOn(parser, "parseBookFile").mockResolvedValue({ sections: [], destroy: () => { destroyed++; } });
  restore.push(() => parse.mockRestore(), () => owner.dispose());
  return { owner, ref, parse, destroyed: () => destroyed };
}

test("format catalog uses the import routing table, without leaking mutable catalog arrays", async () => {
  const formats = await listBookFormats();
  expect(formats).toHaveLength(9);
  for (const entry of formats) {
    for (const extension of entry.extensions) expect(formatFromName("book." + extension.toUpperCase())).toBe(entry.format);
    for (const mime of entry.mimeTypes) expect(formatFromName("book", mime)).toBe(entry.format);
  }
  formats[0]!.extensions.push("unsafe");
  expect(BOOK_IMPORT_FORMATS[0]!.extensions).not.toContain("unsafe");
});

test("inspection requires an own sealed resource, reports initialization only and always destroys successful parsers", async () => {
  const f = await fixture();
  await expect(inspectResourceBook(f.owner, "foreign")).rejects.toMatchObject({ code: "fs/not-found" });
  expect(f.parse).not.toHaveBeenCalled();
  expect(await inspectResourceBook(f.owner, f.ref.id)).toEqual({ formatHint: "epub", status: "parsed", coverage: "initialization", sectionCount: 0, errorCode: null });
  expect(f.destroyed()).toBe(1);
  expect((await f.owner.stat(f.ref.id)).state).toBe("ready");
});

test("encrypted, unsupported and unknown parse failures are distinct; infrastructure failures are not corrupt books", async () => {
  const f = await fixture();
  for (const [failure, status, code] of [
    [new AppError("book/unsupported-encryption", "private DRM details"), "encrypted", "book/unsupported-encryption"],
    [Object.assign(new Error("password"), { name: "PasswordException" }), "encrypted", "book/unsupported-encryption"],
    [new AppError("book/unsupported-format", "private format"), "unsupported", "book/unsupported-format"],
    [new Error("private parse detail"), "failed", "book/parse-failed"],
  ] as const) {
    f.parse.mockRejectedValue(failure);
    const result = await inspectResourceBook(f.owner, f.ref.id);
    expect(result).toMatchObject({ status, errorCode: code, sectionCount: null });
    expect(JSON.stringify(result)).not.toContain("private");
  }
  f.parse.mockRejectedValue(new AppError("fs/not-found", "lease expired"));
  await expect(inspectResourceBook(f.owner, f.ref.id)).rejects.toMatchObject({ code: "fs/not-found" });
});

test("cancellation drains a completed parser without returning success", async () => {
  const f = await fixture(), signal = new AbortController();
  const gate = Promise.withResolvers<Awaited<ReturnType<typeof parser.parseBookFile>>>();
  f.parse.mockImplementation(() => gate.promise);
  const result = inspectResourceBook(f.owner, f.ref.id, signal.signal).catch(error => error);
  await Bun.sleep(0); signal.abort();
  let destroyed = false; gate.resolve({ sections: [], destroy: () => { destroyed = true; } });
  expect(await result).toBeInstanceOf(DOMException);
  expect(destroyed).toBe(true);
  expect(f.parse).toHaveBeenCalledTimes(1);
});

test("resource parser source preserves slice semantics, bounded IPC and short-read failure", async () => {
  const calls: number[][] = [], bytes = new Uint8Array(RESOURCE_MAX_CHUNK + 3); bytes[bytes.length - 1] = 7;
  const read = spyOn(nativeResourceFiles, "read").mockImplementation(async (_id, offset, length) => {
    calls.push([offset, length]); return bytes.slice(offset, offset + length).buffer;
  });
  restore.push(() => read.mockRestore());
  const file = resourceBookFile({ id: "native", size: bytes.length, name: "book.pdf", mimeType: "application/pdf" });
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  expect(calls).toEqual([[0, RESOURCE_MAX_CHUNK], [RESOURCE_MAX_CHUNK, 3]]);
  expect([...new Uint8Array(await file.slice(-2).arrayBuffer())]).toEqual([0, 7]);
  expect((await file.slice(2, 1).arrayBuffer()).byteLength).toBe(0);
  read.mockResolvedValue(new ArrayBuffer(0));
  await expect(file.slice(0, 3).arrayBuffer()).rejects.toMatchObject({ code: "fs/not-found" });
});
