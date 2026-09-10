import { expect, test } from "bun:test";
import { RESOURCE_MAX_CHUNK } from "@read-aware/core";
import { exportResourceBytes, copyResourceImageBytes } from "./resource-export";

function fixture() {
  const calls: string[] = [], chunks: Uint8Array[] = [], errors: unknown[] = [];
  const io = {
    create: async () => { calls.push("create"); return { id: "native", size: 0 }; },
    append: async (_id: string, offset: number, data: Uint8Array) => { calls.push("append"); chunks.push(data.slice()); return offset + data.length; },
    commit: async () => { calls.push("commit"); },
    save: async (_id: string, name: string, _signal?: AbortSignal) => { calls.push(`save:${name}`); return false; },
    release: async () => { calls.push("release"); },
  };
  return { io, calls, chunks, errors, report: (error: unknown) => { errors.push(error); } };
}

test("convenience export copies input, chunks, seals, saves and releases on user cancel", async () => {
  const f = fixture(), bytes = new Uint8Array(RESOURCE_MAX_CHUNK + 3).fill(7);
  const result = exportResourceBytes(f.io, "notes.bin", bytes, f.report); bytes.fill(9);
  expect(await result).toBe(false);
  expect(f.calls).toEqual(["create", "append", "append", "commit", "save:notes.bin", "release"]);
  expect(f.chunks.map(chunk => chunk.length)).toEqual([RESOURCE_MAX_CHUNK, 3]);
  expect(f.chunks[0]![0]).toBe(7);
});

test("native reader image copy shares staging and releases on success or clipboard failure", async () => {
  const f = fixture();
  const io = { ...f.io, copyImage: async (id: string) => { expect(id).toBe("native"); f.calls.push("copy"); return { copied: true as const, width: 2, height: 3 }; } };
  expect(await copyResourceImageBytes(io, new Uint8Array([1]), f.report)).toEqual({ copied: true, width: 2, height: 3 });
  expect(f.calls).toEqual(["create", "append", "commit", "copy", "release"]);
  io.copyImage = async () => { throw Error("clipboard unavailable"); };
  await expect(copyResourceImageBytes(io, new Uint8Array([1]), f.report)).rejects.toThrow("clipboard unavailable");
  expect(f.calls.at(-1)).toBe("release");
  const before = f.calls.length;
  await expect(copyResourceImageBytes(io, new Uint8Array(16 * 1024 * 1024 + 1), f.report)).rejects.toMatchObject({ code: "ui/invalid-target" });
  expect(f.calls.length).toBe(before);
});

test("failed or cancelled writes are released and never advance to save", async () => {
  const f = fixture();
  f.io.append = async () => { throw Error("disk full"); };
  await expect(exportResourceBytes(f.io, "file.txt", "text", f.report)).rejects.toThrow("disk full");
  expect(f.calls).toEqual(["create", "release"]);
  const g = fixture(), abort = new AbortController();
  g.io.append = async (_id, offset, data) => { abort.abort(); return offset + data.length; };
  await expect(exportResourceBytes(g.io, "file.txt", "text", g.report, abort.signal)).rejects.toThrow();
  expect(g.calls).toEqual(["create", "release"]);
});

test("UTF-8 and empty files export faithfully; cleanup failure does not hide a successful save", async () => {
  const f = fixture(); f.io.save = async () => true; f.io.release = async () => { throw Error("cleanup"); };
  expect(await exportResourceBytes(f.io, "unicode.txt", "中文", f.report)).toBe(true);
  expect(new TextDecoder().decode(f.chunks[0])).toBe("中文"); expect(f.errors).toHaveLength(1);
  const g = fixture(); expect(await exportResourceBytes(g.io, "empty.txt", "", g.report)).toBe(false);
  expect(g.calls).toEqual(["create", "commit", "save:empty.txt", "release"]);
});
