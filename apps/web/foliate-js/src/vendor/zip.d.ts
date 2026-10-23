export interface ZipEntry {
  filename: string;
  uncompressedSize: number;
  getData<T>(writer: T): Promise<T extends TextWriter ? string : Blob>;
}

export class TextWriter {
  private readonly writerType: 'text';
}

export class BlobWriter {
  private readonly writerType: 'blob';
  constructor(type?: string);
}

export class BlobReader {
  constructor(blob: Blob);
}

export class ZipReader {
  constructor(reader: BlobReader);
  getEntries(): Promise<ZipEntry[]>;
}

export function configure(options: {
  useWebWorkers: boolean;
  /** Fallback inflate implementation for engines without `DecompressionStream`
   * (iOS 16.0–16.3, issue #41). zip.js prefers the native constructor and uses
   * this otherwise — or when the native one throws. */
  DecompressionStreamZlib?: new (
    format: string,
    options?: unknown,
  ) => TransformStream<Uint8Array, Uint8Array>;
}): void;
