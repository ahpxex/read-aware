import { describe, expect, test } from "bun:test";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { DictdDict, StarDict } from "../foliate-js/src/dict.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function dictZip(text: string, chunkLength = 4): Blob {
  const bytes = encoder.encode(text);
  const chunks = Array.from({ length: Math.ceil(bytes.length / chunkLength) }, (_, i) =>
    deflateRawSync(bytes.subarray(i * chunkLength, (i + 1) * chunkLength)));
  const extraLength = 10 + chunks.length * 2;
  const header = new Uint8Array(12 + extraLength);
  const view = new DataView(header.buffer);
  header.set([31, 139, 8, 4]);
  view.setUint16(10, extraLength, true);
  header.set([82, 65], 12);
  view.setUint16(14, extraLength - 4, true);
  view.setUint16(16, 1, true);
  view.setUint16(18, chunkLength, true);
  view.setUint16(20, chunks.length, true);
  chunks.forEach((chunk, i) => view.setUint16(22 + i * 2, chunk.length, true));
  return new Blob([header, ...chunks]);
}

function starIndex(entries: Array<[string, number, number?]>): Blob {
  return new Blob(entries.map(([word, offset, size]) => {
    const name = encoder.encode(word);
    const bytes = new Uint8Array(name.length + (size === undefined ? 5 : 9));
    bytes.set(name);
    const view = new DataView(bytes.buffer);
    view.setUint32(name.length + 1, offset);
    if (size !== undefined) view.setUint32(name.length + 5, size);
    return bytes;
  }));
}

describe("dictionary indexes and compressed ranges", () => {
  test("empty and singleton indexes terminate for missing entries", async () => {
    const dict = new StarDict();
    await dict.loadIdx(starIndex([]));
    expect(await dict.lookup("word")).toEqual([]);
    await dict.loadIdx(starIndex([["middle", 0, 4]]));
    expect(await dict.lookup("aaa")).toEqual([]);
    expect(await dict.lookup("zzz")).toEqual([]);
    expect(await dict.synonyms("missing")).toEqual([]);
  });

  test("duplicate entries, synonyms and exact final chunk boundaries", async () => {
    const dict = new StarDict();
    await dict.loadIfo(new Blob(["StarDict's dict ifo file\nversion=2.4.2\nsametypesequence=m\n"]));
    await dict.loadDict(dictZip("one!two!last"), inflateRawSync);
    await dict.loadIdx(starIndex([["apple", 0, 4], ["apple", 4, 4], ["pear", 8, 4]]));
    await dict.loadSyn(starIndex([["fruit", 2]]));
    expect((await dict.lookup("APPLE")).map(entry => decoder.decode(entry.data[0][1])))
      .toEqual(["one!", "two!"]);
    expect((await dict.synonyms("fruit")).map(entry => [entry.word, decoder.decode(entry.data[0][1])]))
      .toEqual([["pear", "last"]]);
  });

  test("ranges span chunks and preserve zero-length entries", async () => {
    const dict = new StarDict();
    await dict.loadIfo(new Blob(["sametypesequence=m"]));
    await dict.loadDict(dictZip("abcdefghij"), async bytes => inflateRawSync(bytes));
    await dict.loadIdx(starIndex([["empty", 0, 0], ["middle", 2, 7]]));
    expect((await dict.lookup("empty"))[0].data[0][1].length).toBe(0);
    expect(decoder.decode((await dict.lookup("middle"))[0].data[0][1])).toBe("cdefghi");
  });

  test("Dictd keeps its public tuple contract and ignores trailing newlines", async () => {
    const dict = new DictdDict();
    await dict.loadIdx(new Blob(["word\tA\tE\n"]));
    await dict.loadDict(dictZip("text"), inflateRawSync);
    const [entry] = await dict.lookup("word");
    expect(entry.word).toBe("word");
    expect(entry.data[0]).toBe("m");
    expect(decoder.decode(await entry.data[1])).toBe("text");
    expect(await dict.lookup("zzz")).toEqual([]);
  });

  test("invalid headers and out-of-bounds index ranges fail explicitly", async () => {
    const dict = new StarDict();
    await expect(dict.loadDict(new Blob([new Uint8Array(12)]), inflateRawSync)).rejects.toThrow("Not a DictZip");
    await dict.loadIfo(new Blob(["sametypesequence=m"]));
    await dict.loadDict(dictZip("text"), inflateRawSync);
    await dict.loadIdx(starIndex([["word", 4, 4]]));
    await expect(dict.lookup("word")).rejects.toThrow("range exceeds");
  });
});
