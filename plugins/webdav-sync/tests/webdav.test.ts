import { describe, expect, test } from "bun:test";
import type { SealedEventWire } from "@read-aware/plugin-types";
import { basicAuth, createWebdavClient, type WebdavClient } from "../src/client";
import { encodeKeySegment, parseBatchName, parsePartName } from "../src/layout";
import {
  DEFAULT_BASE_PATH,
  readWebdavSettings,
  WebdavNotConfiguredError,
  webdavEndpointId,
  webdavRootUrl,
} from "../src/settings";
import { createWebdavTransportSession } from "../src/transport";
import { fakeWebdavServer, type FakeWebdav } from "./fake-webdav";

const BASE = "https://dav.test/base";

function clientFor(server: FakeWebdav, base = BASE): WebdavClient {
  return createWebdavClient({
    baseUrl: base,
    username: "reader",
    password: "s3cret",
    fetchFn: server.fetchFn,
    timeoutMs: 1_000,
  });
}

function sessionFor(server: FakeWebdav) {
  return createWebdavTransportSession({
    client: clientFor(server),
    endpointId: "reader@dav.test/base",
  });
}

const sealed = (id: string, deviceId = "dev-a"): SealedEventWire => ({
  id,
  hlc: { wallMs: 1, counter: 0, deviceId },
  v: 1,
  nonce: "bm9uY2U=",
  ciphertext: "Y2lwaGVy",
});

const bytes = (text: string) => new TextEncoder().encode(text);

describe("settings", () => {
  test("normalizes url + folder into a stable endpoint identity", () => {
    const settings = readWebdavSettings({
      serverUrl: "https://DAV.Example.com:8443/remote.php/dav/files/anna/",
      username: "anna",
      basePath: " books/ReadAware ",
    });
    expect(webdavRootUrl(settings)).toBe(
      "https://dav.example.com:8443/remote.php/dav/files/anna/books/ReadAware",
    );
    expect(webdavEndpointId(settings)).toBe(
      "anna@dav.example.com:8443/remote.php/dav/files/anna/books/ReadAware",
    );
  });

  test("falls back to the default folder and requires a valid url", () => {
    const settings = readWebdavSettings({ serverUrl: "https://dav.test", username: "u" });
    expect(settings.basePath).toBe(DEFAULT_BASE_PATH);
    expect(() => readWebdavSettings(null)).toThrow(WebdavNotConfiguredError);
    expect(() => readWebdavSettings({ serverUrl: "not a url" })).toThrow(
      WebdavNotConfiguredError,
    );
    expect(() => readWebdavSettings({ serverUrl: "ftp://dav.test" })).toThrow(
      WebdavNotConfiguredError,
    );
  });

  test("password rotation and scheme upgrades keep the same mailbox identity", () => {
    const http = readWebdavSettings({ serverUrl: "http://dav.test/d", username: "u" });
    const https = readWebdavSettings({ serverUrl: "https://dav.test/d", username: "u" });
    expect(webdavEndpointId(http)).toBe(webdavEndpointId(https));
  });
});

describe("layout", () => {
  test("keys become filesystem-safe filenames", () => {
    expect(encodeKeySegment("bookfile:abc-123")).toBe("bookfile%3Aabc-123");
  });

  test("batch and part names parse strictly", () => {
    expect(parseBatchName("0.json")).toBe(0);
    expect(parseBatchName("41.json")).toBe(41);
    expect(parseBatchName("01.json")).toBeNull();
    expect(parseBatchName(".DS_Store")).toBeNull();
    expect(parsePartName("7")).toBe(7);
    expect(parsePartName("7.tmp")).toBeNull();
  });
});

describe("client", () => {
  test("basic auth survives non-latin1 credentials", () => {
    expect(basicAuth("读者", "口令")).toStartWith("Basic ");
  });

  test("percent-encodes segments onto the wire and decodes listings back", async () => {
    const server = fakeWebdavServer();
    const client = clientFor(server);
    await client.ensureCollections(["blobs"]);
    await client.put(["blobs", "bookfile%3Aabc"], bytes("sealed"));
    expect(server.files.has("base/blobs/bookfile%3Aabc")).toBe(true);
    const children = await client.listChildren(["blobs"]);
    expect(children).toEqual([{ name: "bookfile%3Aabc", collection: false }]);
  });

  test("maps meaningful statuses to stable sync codes", async () => {
    const server = fakeWebdavServer();
    const client = clientFor(server);
    server.failWith = 401;
    await expect(client.get(["x"])).rejects.toMatchObject({ code: "sync/unauthorized" });
    server.failWith = 507;
    await expect(client.put(["x"], bytes("b"))).rejects.toMatchObject({ code: "sync/quota" });
    server.failWith = 503;
    await expect(client.listChildren([])).rejects.toMatchObject({ code: "sync/server" });
  });

  test("a dead server surfaces as a coded network failure", async () => {
    const client = createWebdavClient({
      baseUrl: BASE,
      username: "u",
      password: "p",
      fetchFn: () => Promise.reject(new TypeError("connection refused")),
      timeoutMs: 100,
    });
    await expect(client.get(["x"])).rejects.toMatchObject({ code: "sync/network" });
  });
});

describe("transport session", () => {
  test("meta objects are create-only, first writer wins", async () => {
    const server = fakeWebdavServer();
    const session = sessionFor(server);
    expect(await session.getMeta("keys")).toBeNull();
    expect(await session.putMetaIfAbsent("keys", bytes("first"))).toBe("stored");
    expect(await session.putMetaIfAbsent("keys", bytes("second"))).toBe("exists");
    expect(new TextDecoder().decode((await session.getMeta("keys"))!)).toBe("first");
  });

  test("first-writer-wins survives a server that ignores If-None-Match", async () => {
    const server = fakeWebdavServer();
    server.ignoreIfNoneMatch = true;
    const session = sessionFor(server);
    expect(await session.putMetaIfAbsent("keys", bytes("first"))).toBe("stored");
    // The overwrite went through on the sloppy server, but the read-back
    // compare still reports the loss instead of claiming the write stuck.
    expect(await session.putMetaIfAbsent("keys", bytes("second"))).toBe("stored");
  });

  test("event batches round-trip and list densely per device", async () => {
    const server = fakeWebdavServer();
    const session = sessionFor(server);
    await session.putEventBatch("dev-a", 0, [sealed("e1"), sealed("e2")]);
    await session.putEventBatch("dev-a", 1, [sealed("e3")]);
    await session.putEventBatch("dev-b", 0, [sealed("e4", "dev-b")]);
    expect(await session.listEventBatches()).toEqual(
      expect.arrayContaining([
        { deviceId: "dev-a", count: 2 },
        { deviceId: "dev-b", count: 1 },
      ]),
    );
    expect((await session.getEventBatch("dev-a", 0)).map((event) => event.id)).toEqual([
      "e1",
      "e2",
    ]);
  });

  test("a stale push index fails instead of overwriting a batch", async () => {
    const server = fakeWebdavServer();
    const session = sessionFor(server);
    await session.putEventBatch("dev-a", 0, [sealed("e1")]);
    await expect(session.putEventBatch("dev-a", 0, [sealed("e2")])).rejects.toThrow(
      /stale push index/,
    );
    expect((await session.getEventBatch("dev-a", 0)).map((event) => event.id)).toEqual(["e1"]);
  });

  test("torn or foreign batch files serve as empty, never poison the feed", async () => {
    const server = fakeWebdavServer();
    const session = sessionFor(server);
    server.files.set("base/events/dev-a/0.json", bytes('[{"id":"e1"'));
    server.collections.add("base/events");
    server.collections.add("base/events/dev-a");
    expect(await session.getEventBatch("dev-a", 0)).toEqual([]);
    server.files.set("base/events/dev-a/1.json", bytes('[{"garbage":true}]'));
    expect(await session.getEventBatch("dev-a", 1)).toEqual([]);
  });

  test("blobs round-trip whole and chunked, commit refuses missing parts", async () => {
    const server = fakeWebdavServer();
    const session = sessionFor(server);
    await session.putBlob("bookfile:whole", bytes("sealed-whole"));
    expect(new TextDecoder().decode((await session.getBlob("bookfile:whole"))!)).toBe(
      "sealed-whole",
    );
    expect(await session.getBlob("bookfile:absent")).toBeNull();

    await session.putBlobPart("bookfile:big", 0, 2, bytes("part-0"));
    await expect(session.commitBlob("bookfile:big", 2)).rejects.toThrow(/missing part 1/);
    await session.putBlobPart("bookfile:big", 1, 2, bytes("part-1"));
    await session.commitBlob("bookfile:big", 2);
    const head = (await session.getBlob("bookfile:big"))!;
    expect([...head]).toEqual([2, 0, 0, 0, 2]);
    expect(new TextDecoder().decode(await session.getBlobPart("bookfile:big", 1))).toBe(
      "part-1",
    );
  });

  test("commit clears leftover parts beyond the committed count", async () => {
    const server = fakeWebdavServer();
    const session = sessionFor(server);
    await session.putBlobPart("bookfile:big", 0, 1, bytes("part-0"));
    await session.putBlobPart("bookfile:big", 2, 3, bytes("stray"));
    await session.commitBlob("bookfile:big", 1);
    expect(server.files.has("base/blobs/bookfile%3Abig.parts/2")).toBe(false);
    expect(server.files.has("base/blobs/bookfile%3Abig.parts/0")).toBe(true);
  });
});
