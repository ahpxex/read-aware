/**
 * A file read in fixed blocks, each fetched once and kept.
 *
 * A reader that wants a few scattered ranges — a ZIP archive's directory,
 * then the entries one page needs — pays for those blocks alone instead of
 * the whole file, and its many small reads inside one block cost a single
 * fetch. The file is Blob-shaped (`size`, `slice`, `arrayBuffer`), which is
 * all the book parsers ask of their source.
 */

/** Blob-compatible random-access source. */
export interface RandomAccessFile {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  slice(start?: number, end?: number, contentType?: string): RandomAccessFile;
}

export type BlockSource = {
  name: string;
  type: string;
  size: number;
  /** Size of one fetch. Every block but the last is exactly this long. */
  blockBytes: number;
  /** Bytes kept at a time; the least recently used blocks beyond it are fetched again when wanted. */
  maxBytes: number;
  /** Fetch `length` bytes at `offset`; must return exactly that many. */
  readRange(offset: number, length: number): Promise<ArrayBuffer>;
};

/** Blocks fetched at once when a read spans many (a whole-file read). */
const BLOCK_FETCH_CONCURRENCY = 4;

/** `Blob.slice` index semantics: negative counts from the end, clamped to the file. */
export function sliceIndex(value: number | undefined, size: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (Number.isNaN(value)) return 0;
  const integer = Number.isFinite(value) ? Math.trunc(value) : value < 0 ? -size : size;
  return integer < 0 ? Math.max(size + integer, 0) : Math.min(integer, size);
}

class Blocks {
  private readonly blocks = new Map<number, Promise<Uint8Array>>();
  private readonly maxBlocks: number;
  constructor(private readonly source: BlockSource) {
    this.maxBlocks = Math.max(1, Math.ceil(source.maxBytes / source.blockBytes));
  }

  private block(index: number): Promise<Uint8Array> {
    const kept = this.blocks.get(index);
    if (kept) {
      // Most recently used last: eviction takes from the front.
      this.blocks.delete(index);
      this.blocks.set(index, kept);
      return kept;
    }
    const { blockBytes, size } = this.source;
    const offset = index * blockBytes;
    const length = Math.min(blockBytes, size - offset);
    const pending = this.source.readRange(offset, length).then((buffer) => {
      if (buffer.byteLength !== length)
        throw new Error(`Managed book file became unavailable while reading ${offset}-${offset + length}.`);
      return new Uint8Array(buffer);
    });
    this.blocks.set(index, pending);
    // A failed block is not kept: the next read asks again.
    pending.catch(() => {
      if (this.blocks.get(index) === pending) this.blocks.delete(index);
    });
    for (const oldest of this.blocks.keys()) {
      if (this.blocks.size <= this.maxBlocks) break;
      this.blocks.delete(oldest);
    }
    return pending;
  }

  async read(offset: number, length: number): Promise<ArrayBuffer> {
    const bytes = new Uint8Array(length);
    if (length === 0) return bytes.buffer;
    const { blockBytes } = this.source;
    const first = Math.floor(offset / blockBytes);
    const last = Math.floor((offset + length - 1) / blockBytes);
    let next = first;
    const worker = async () => {
      while (next <= last) {
        const index = next++;
        const block = await this.block(index);
        const blockStart = index * blockBytes;
        const from = Math.max(offset, blockStart);
        const to = Math.min(offset + length, blockStart + block.length);
        bytes.set(block.subarray(from - blockStart, to - blockStart), from - offset);
      }
    };
    await Promise.all(Array.from({ length: Math.min(BLOCK_FETCH_CONCURRENCY, last - first + 1) }, worker));
    return bytes.buffer;
  }
}

class BlockSlice implements RandomAccessFile {
  constructor(
    private readonly blocks: Blocks,
    readonly name: string,
    readonly type: string,
    private readonly offset: number,
    readonly size: number,
  ) {}
  arrayBuffer(): Promise<ArrayBuffer> {
    return this.blocks.read(this.offset, this.size);
  }
  slice(start?: number, end?: number, contentType = ""): RandomAccessFile {
    const relativeStart = sliceIndex(start, this.size, 0);
    const relativeEnd = sliceIndex(end, this.size, this.size);
    return new BlockSlice(
      this.blocks,
      this.name,
      contentType.toLowerCase(),
      this.offset + relativeStart,
      Math.max(relativeEnd - relativeStart, 0),
    );
  }
}

export function blockCachedFile(source: BlockSource): RandomAccessFile {
  return new BlockSlice(new Blocks(source), source.name, source.type, 0, source.size);
}
