import { Inflate } from "./vendor/fflate.js";

/**
 * What zip.js needs from `DecompressionStream` on engines that lack it
 * (iOS 16.0–16.3, issue #41): a TransformStream over raw DEFLATE backed by the
 * vendored fflate `Inflate`. Only "deflate-raw" — the compression ZIP stores —
 * is supported; any other format fails construction with a TypeError the way
 * the native constructor rejects unknown formats. fflate reports corrupt
 * input by throwing synchronously inside `push`, which errors this stream
 * through `transform`/`flush`.
 */
export class RawInflateStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor(format: string, _options?: unknown) {
    if (format !== "deflate-raw") {
      throw new TypeError(`Unsupported compression format: ${format}`);
    }
    let sink!: TransformStreamDefaultController<Uint8Array>;
    const inflater = new Inflate((chunk) => {
      if (chunk.length) sink.enqueue(chunk);
    });
    super({
      start: (controller) => {
        sink = controller;
      },
      transform: (chunk) => {
        inflater.push(chunk);
      },
      flush: () => {
        inflater.push(new Uint8Array(), true);
      },
    });
  }
}
