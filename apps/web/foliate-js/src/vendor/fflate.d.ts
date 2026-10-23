export function unzlibSync(data: Uint8Array): Uint8Array;
/** Streaming raw-DEFLATE decompressor; `ondata` receives each inflated chunk.
 * Corrupt input throws synchronously from `push`. */
export class Inflate {
  constructor(ondata: (chunk: Uint8Array, final: boolean) => void);
  push(chunk: Uint8Array, final?: boolean): void;
}
