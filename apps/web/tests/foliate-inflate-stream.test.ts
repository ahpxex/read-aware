import { expect, test } from "bun:test";
import { deflateRawSync } from "node:zlib";
import { zipSync } from "fflate";
import type { RawInflateStream as RawInflateStreamType } from "../foliate-js/src/inflate-stream";
import type { makeBook as makeBookType } from "../foliate-js/src/book-loader";
import { makeEPUBFixture } from "./fixtures/foliate-epub";
import { withDom } from "./helpers/foliate-dom";

// The runtime under test is the emitted engine — what the app actually loads —
// whose vendor/ imports resolve to public/foliate-js/vendor/.
const emitted = (name: string) => new URL(`../public/foliate-js/${name}.js`, import.meta.url).href;

test("RawInflateStream inflates raw DEFLATE across chunk boundaries and errors like the native", async () => {
  const { RawInflateStream } = (await import(emitted("inflate-stream"))) as {
    RawInflateStream: typeof RawInflateStreamType;
  };
  const source = new TextEncoder().encode("The stream inflates a whole EPUB payload. ".repeat(400));
  const deflated = deflateRawSync(source);
  // Split mid-token so decompression provably spans input chunks.
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < deflated.length; offset += 97) {
    chunks.push(deflated.subarray(offset, offset + 97));
  }
  const inflated = await new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }).pipeThrough(new RawInflateStream("deflate-raw")),
  ).arrayBuffer();
  expect(new Uint8Array(inflated)).toEqual(new Uint8Array(source));

  expect(() => new RawInflateStream("deflate64-raw")).toThrow(TypeError);
  expect(() => new RawInflateStream("gzip")).toThrow(TypeError);

  const corrupt = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(deflateRawSync(source).subarray(0, 12));
      controller.close();
    },
  }).pipeThrough(new RawInflateStream("deflate-raw"));
  await expect(new Response(corrupt).arrayBuffer()).rejects.toThrow();
});

test("makeBook opens a deflated EPUB on an engine with no DecompressionStream", () =>
  withDom(async () => {
    const files: Record<string, Uint8Array> = {};
    for (const [path, content] of makeEPUBFixture().files) {
      files[path] =
        typeof content === "string" ? new TextEncoder().encode(content) : new Uint8Array(await content.arrayBuffer());
    }
    const zip = zipSync(files, { level: 9 });
    // iOS 16.0–16.3 WebKit has no DecompressionStream (issue #41).
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "DecompressionStream");
    Reflect.deleteProperty(globalThis, "DecompressionStream");
    // If a future engine makes the global non-configurable the fallback is not
    // under test — fail loudly rather than pass vacuously.
    expect(globalThis.DecompressionStream).toBeUndefined();
    try {
      const { makeBook } = (await import(emitted("book-loader"))) as { makeBook: typeof makeBookType };
      const book = await makeBook(new File([zip], "fixture.epub"));
      try {
        expect(book.metadata?.title).toBe("EPUB Engine Fixture");
        expect(book.sections).toHaveLength(2);
        const doc = await book.sections[0]!.createDocument!();
        expect(doc.querySelector("em")?.textContent).toBe("EPUB");
      } finally {
        void book.destroy?.();
      }
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "DecompressionStream", descriptor);
    }
  }));
