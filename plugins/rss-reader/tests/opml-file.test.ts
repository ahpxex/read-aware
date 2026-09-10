import { expect, test } from "bun:test";
import type { PluginContext } from "@read-aware/plugin-types";
import { pickOpmlText } from "../src/opml-file";
import { feedUrlsFromOpml, MAX_OPML_BYTES, MAX_OPML_FEEDS } from "../src/opml";

function fixture(bytes: Uint8Array, options: { cancelled?: boolean; size?: number; failRead?: boolean } = {}) {
  const released: string[] = [], reads: number[] = [];
  const ctx = { services: { resources: {
    pick: async (input: unknown) => { expect(input).toEqual({ multiple: false, extensions: ["opml", "xml"] }); return {
      cancelled: !!options.cancelled, resources: options.cancelled ? [] : [{ id: "picked", size: options.size ?? bytes.byteLength }],
    }; },
    read: async (id: string, offset: number) => {
      expect(id).toBe("picked"); reads.push(offset); if (options.failRead) throw Object.assign(Error("Locked"), { code: "fs/permission" });
      const end = Math.min(offset + 3, bytes.length);
      return { data: bytes.slice(offset, end).buffer, nextOffset: end, eof: end === bytes.length };
    },
    release: async (id: string) => { released.push(id); },
  } } } as unknown as PluginContext;
  return { ctx, reads, released };
}

test("OPML file selection decodes split UTF-8, releases the handle and does not subscribe", async () => {
  const text = '<opml><body><outline text="书" xmlUrl="https://example.com/feed"/></body></opml>';
  const f = fixture(new TextEncoder().encode(text));
  expect(await pickOpmlText(f.ctx)).toBe(text); expect(f.released).toEqual(["picked"]);
  expect(f.reads.length).toBeGreaterThan(1);
  const cancelled = fixture(new Uint8Array(), { cancelled: true });
  expect(await pickOpmlText(cancelled.ctx)).toBeNull(); expect(cancelled.reads).toEqual([]);
});

test("OPML resource errors preserve stable codes and release handles", async () => {
  const big = fixture(new Uint8Array(), { size: MAX_OPML_BYTES + 1 });
  await expect(pickOpmlText(big.ctx)).rejects.toMatchObject({ code: "plugin/payload-too-large" });
  expect(big.reads).toEqual([]); expect(big.released).toEqual(["picked"]);
  const denied = fixture(new Uint8Array(), { failRead: true });
  await expect(pickOpmlText(denied.ctx)).rejects.toMatchObject({ code: "fs/permission" }); expect(denied.released).toEqual(["picked"]);
  const invalid = fixture(new Uint8Array([255, 255]));
  await expect(pickOpmlText(invalid.ctx)).rejects.toMatchObject({ code: "plugin/invalid-input" }); expect(invalid.released).toEqual(["picked"]);
});

test("OPML limits reject the whole document rather than silently truncating subscriptions", () => {
  expect(() => feedUrlsFromOpml("x".repeat(MAX_OPML_BYTES + 1))).toThrow();
  const entries = Array.from({ length: MAX_OPML_FEEDS + 1 }, (_, i) => `<outline xmlUrl="https://example.com/${i}"/>`).join("");
  expect(() => feedUrlsFromOpml(`<opml><body>${entries}</body></opml>`)).toThrow();
  expect(feedUrlsFromOpml('<opml><body><outline><outline xmlUrl="https://example.com/1"/></outline><outline xmlUrl="https://example.com/2"/></body></opml>'))
    .toEqual(["https://example.com/1", "https://example.com/2"]);
});
