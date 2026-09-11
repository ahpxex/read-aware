import { afterEach, expect, spyOn, test } from "bun:test";
import type { TFunction } from "i18next";
import * as environment from "../../../platform/environment";
import * as ipc from "../../../platform/ipc";
import * as blobs from "../../../platform/blob-store";
import * as events from "../../../platform/domain-events";
import * as library from "./library-db";
import { importBook, pendingImportPlaceholder } from "./book-import";
import type { BookImportSource } from "./library-types";

const source: BookImportSource = { kind: "native-resource", resourceId: "private-native-id", name: "book.txt", size: 7, type: "text/plain" };
const t = ((key: string) => key) as TFunction<"shelf">;
const staged = { sha256: "content-hash", byteSize: 7, duplicateOf: null, title: "New book", author: null, cover: "none", metadataDeferred: false };
const restore: Array<() => void> = [];
afterEach(() => { for (const cleanup of restore.splice(0).reverse()) cleanup(); });

function setup() {
  const native = spyOn(environment, "isTauri").mockReturnValue(true);
  const invoke = spyOn(ipc, "invoke").mockResolvedValue(staged);
  const put = spyOn(blobs, "putDesktopBlob").mockResolvedValue({ sha256: "content-hash", byteSize: 7 });
  const commit = spyOn(events, "commitDomainEvents").mockResolvedValue({ appended: 2, applied: 2 });
  const book = pendingImportPlaceholder("existing", source, "txt");
  const get = spyOn(library, "getBookRecord").mockResolvedValue(book);
  for (const mock of [native, invoke, put, commit, get]) restore.push(() => mock.mockRestore());
  return { invoke, put, commit, get, book };
}

test("resource imports stage natively and use content deduplication even with matching name and size", async () => {
  const { invoke, put, commit, book } = setup();
  const result = await importBook(source, { t, knownBooks: [book], origin: "plugin:fixture" });
  expect(result.status).toBe("imported");
  expect(invoke).toHaveBeenCalledWith("library_stage_import", { request: {
    bookId: expect.any(String), format: "txt", mimeType: "text/plain",
    source: { kind: "resource", id: "private-native-id" },
  } });
  expect(put).not.toHaveBeenCalled();
  expect(commit.mock.calls[0]?.[0]).toMatchObject({ type: "book.imported", origin: "plugin:fixture",
    payload: { sourceSha256: "content-hash", fileSize: 7, title: "New book" } });
});

test("native resource duplicate receipt points to the existing book without another import event", async () => {
  const { invoke, put, commit, book } = setup();
  invoke.mockResolvedValue({ ...staged, duplicateOf: book.id });
  expect(await importBook(source, { t, knownBooks: [book] })).toEqual({ status: "duplicate", book });
  expect(commit).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
});

test("external paths carry native admission epochs while manual paths do not", async () => {
  const { invoke } = setup();
  const path: BookImportSource = { kind: "native-path", path: "/books/book.txt", name: "book.txt", size: 7 };
  await importBook({ ...path, externalOpenEpoch: "accepted-batch" }, { t, knownBooks: [] });
  expect(invoke).toHaveBeenCalledWith("library_stage_import", { request: {
    bookId: expect.any(String), format: "txt", mimeType: null,
    externalOpenEpoch: "accepted-batch", source: { kind: "path", path: path.path },
  } });
  invoke.mockClear();
  await importBook(path, { t, knownBooks: [] });
  expect(invoke).toHaveBeenCalledWith("library_stage_import", { request: {
    bookId: expect.any(String), format: "txt", mimeType: null,
    source: { kind: "path", path: path.path },
  } });
});

test("revoked native admission cannot commit an import event", async () => {
  const { invoke, commit } = setup();
  const error = { code: "ui/unavailable", message: "External request revoked" };
  invoke.mockRejectedValue(error);
  await expect(importBook({ kind: "native-path", path: "/books/book.txt", name: "book.txt", size: 7,
    externalOpenEpoch: "revoked-batch" }, { t, knownBooks: [] })).rejects.toBe(error);
  expect(commit).not.toHaveBeenCalled();
});

test("cancellation prevents native staging but does not abandon an already accepted import", async () => {
  const { invoke, commit } = setup();
  await expect(importBook(source, { t, knownBooks: [], signal: AbortSignal.abort() })).rejects.toBeDefined();
  expect(invoke).not.toHaveBeenCalled();
  const controller = new AbortController();
  invoke.mockImplementation(async () => { controller.abort(); return staged as never; });
  expect((await importBook(source, { t, knownBooks: [], signal: controller.signal })).status).toBe("imported");
  expect(commit).toHaveBeenCalledTimes(1);
});
