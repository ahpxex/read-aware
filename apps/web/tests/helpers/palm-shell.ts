import { countBitsSet, decompressPalmDOC, getVarLenFromEnd } from "../../foliate-js/src/mobi-binary.js";
import type { PalmRecordsPort } from "../../src/platform/palm-records";

/**
 * The native shell's side of a Palm database book (`palm_book.rs`), over a
 * fixture's bytes: the record table, the framed record and text responses and
 * the resource route. Decompression is the engine's own, which the shell's
 * mirrors.
 */
export async function palmShell(file: Blob) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const count = view.getUint16(76);
  const starts = Array.from({ length: count }, (_, index) => view.getUint32(78 + index * 8));
  const records = starts.map((start, index) => bytes.slice(start, starts[index + 1] ?? bytes.length));
  const requests: string[] = [];

  const frame = (parts: Uint8Array[]) => {
    const body = new Uint8Array(4 + parts.length * 4 + parts.reduce((sum, part) => sum + part.length, 0));
    const header = new DataView(body.buffer);
    header.setUint32(0, parts.length, true);
    let offset = 4 + parts.length * 4;
    parts.forEach((part, index) => {
      header.setUint32(4 + index * 4, part.length, true);
      body.set(part, offset);
      offset += part.length;
    });
    return body;
  };
  const text = (record: Uint8Array, compression: number, trailingFlags: number) => {
    for (let entry = 0; entry < countBitsSet(trailingFlags >>> 1); entry++) {
      const length = getVarLenFromEnd(record);
      if (!length || length > record.length) throw new Error("Invalid MOBI trailing entry length");
      record = record.subarray(0, -length);
    }
    if (trailingFlags & 1) record = record.subarray(0, -((record[record.length - 1] & 0b11) + 1));
    return compression === 2 ? decompressPalmDOC(record) : record;
  };

  const port: PalmRecordsPort = {
    open: async () => ({
      contentVersion: "sha256:rev",
      lengths: records.map((record) => record.length),
      magics: records.map((record) => {
        const head = record.subarray(0, 4);
        return head.length === 4 && head.every((byte) => (byte >= 65 && byte <= 90) || (byte >= 48 && byte <= 57))
          ? String.fromCharCode(...head)
          : "";
      }),
      head: btoa(String.fromCharCode(...records[0])),
    }),
    resourceUrl: (path) => `rablob://localhost/${path}`,
    fetch: async (url) => {
      const { pathname, searchParams } = new URL(url);
      const [, kind, target] = pathname.match(/^\/palm\/book-1\/rev\/(\w+)\/([\d-]+)$/) ?? [];
      requests.push(`${kind}/${target}`);
      const [first, last = first] = (target ?? "").split("-").map(Number);
      const span = records.slice(first, last + 1);
      if (!kind || span.length !== last - first + 1) return new Response(null, { status: 404 });
      try {
        if (kind === "records") return new Response(frame(span));
        if (kind === "text")
          return new Response(
            frame(span.map((record) => text(record, Number(searchParams.get("c")), Number(searchParams.get("t"))))),
          );
        if (kind === "resource") return new Response(span[0], { headers: { "content-type": "image/png" } });
      } catch {
        // What the shell answers when the file cannot be read as its format.
        return new Response(null, { status: 422 });
      }
      return new Response(null, { status: 404 });
    },
  };
  return { port, requests, records };
}
