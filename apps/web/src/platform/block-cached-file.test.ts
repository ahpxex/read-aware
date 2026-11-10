import { expect, test } from "bun:test";
import { blockCachedFile } from "./block-cached-file";

/** A file of `size` bytes whose byte at `i` is `i % 251`, read through counted range fetches. */
function source(size: number, blockBytes: number, maxBytes = 1 << 20) {
  const data = Uint8Array.from({ length: size }, (_, index) => index % 251);
  const fetches: [number, number][] = [];
  let fail = false;
  const file = blockCachedFile({
    name: "book.epub",
    type: "application/epub+zip",
    size,
    blockBytes,
    maxBytes,
    readRange: async (offset, length) => {
      fetches.push([offset, length]);
      if (fail) throw new Error("range unavailable");
      return data.slice(offset, offset + length).buffer;
    },
  });
  const bytes = async (start: number, end: number) => [...new Uint8Array(await file.slice(start, end).arrayBuffer())];
  return {
    file,
    data,
    fetches,
    bytes,
    failing: (value: boolean) => {
      fail = value;
    },
  };
}

test("a range is assembled from the blocks it touches, each fetched once", async () => {
  const s = source(1000, 100);
  // Inside one block, across a boundary, and across several.
  expect(await s.bytes(10, 20)).toEqual([...s.data.subarray(10, 20)]);
  expect(await s.bytes(95, 105)).toEqual([...s.data.subarray(95, 105)]);
  expect(await s.bytes(250, 620)).toEqual([...s.data.subarray(250, 620)]);
  expect(s.fetches.toSorted((a, b) => a[0] - b[0])).toEqual([
    [0, 100],
    [100, 100],
    [200, 100],
    [300, 100],
    [400, 100],
    [500, 100],
    [600, 100],
  ]);
  // Everything read so far is served again without a fetch.
  const before = s.fetches.length;
  expect(await s.bytes(0, 700)).toEqual([...s.data.subarray(0, 700)]);
  expect(s.fetches.length).toBe(before);
});

test("the last block is short, and a whole-file read returns every byte", async () => {
  const s = source(1050, 100);
  expect(await s.bytes(1040, 1050)).toEqual([...s.data.subarray(1040, 1050)]);
  expect(s.fetches).toEqual([[1000, 50]]);
  expect([...new Uint8Array(await s.file.arrayBuffer())]).toEqual([...s.data]);
  expect(s.file.size).toBe(1050);
});

test("slices follow Blob semantics and share one cache", async () => {
  const s = source(1000, 100);
  const tail = s.file.slice(-30);
  expect(tail.size).toBe(30);
  expect([...new Uint8Array(await tail.arrayBuffer())]).toEqual([...s.data.subarray(970, 1000)]);
  const inner = s.file.slice(900, 2000, "TEXT/Plain").slice(5, 15);
  expect(inner.size).toBe(10);
  expect(s.file.slice(900, 2000, "TEXT/Plain").type).toBe("text/plain");
  expect([...new Uint8Array(await inner.arrayBuffer())]).toEqual([...s.data.subarray(905, 915)]);
  expect(s.fetches).toEqual([[900, 100]]);
  expect((await s.file.slice(40, 40).arrayBuffer()).byteLength).toBe(0);
  expect((await s.file.slice(60, 20).arrayBuffer()).byteLength).toBe(0);
  expect(s.fetches.length).toBe(1);
});

test("concurrent reads of one block share its fetch", async () => {
  const s = source(1000, 100);
  const [a, b] = await Promise.all([s.bytes(0, 10), s.bytes(50, 60)]);
  expect(a).toEqual([...s.data.subarray(0, 10)]);
  expect(b).toEqual([...s.data.subarray(50, 60)]);
  expect(s.fetches).toEqual([[0, 100]]);
});

test("only the most recently used blocks are kept; an older one is fetched again", async () => {
  // Room for two blocks.
  const s = source(1000, 100, 200);
  await s.bytes(0, 10);
  await s.bytes(100, 110);
  await s.bytes(0, 10); // block 0 is now the more recent of the two
  await s.bytes(200, 210); // evicts block 1
  expect(s.fetches.length).toBe(3);
  await s.bytes(0, 10);
  expect(s.fetches.length).toBe(3);
  await s.bytes(100, 110);
  expect(s.fetches.length).toBe(4);
  // A read wider than the cache still returns every byte.
  expect(await s.bytes(0, 1000)).toEqual([...s.data]);
});

test("a failed block is not kept, and a short answer is a failure", async () => {
  const s = source(1000, 100);
  s.failing(true);
  await expect(s.bytes(0, 10)).rejects.toThrow("range unavailable");
  s.failing(false);
  expect(await s.bytes(0, 10)).toEqual([...s.data.subarray(0, 10)]);
  expect(s.fetches.length).toBe(2);
  const short = blockCachedFile({
    name: "short",
    type: "",
    size: 100,
    blockBytes: 100,
    maxBytes: 1000,
    readRange: async () => new ArrayBuffer(40),
  });
  await expect(short.arrayBuffer()).rejects.toThrow("became unavailable");
});
