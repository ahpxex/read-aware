export interface ZipEntry {
  filename: string;
  uncompressedSize: number;
  getData<T>(writer: T): Promise<T extends TextWriter ? string : Blob>;
}

export class TextWriter {}

export class BlobWriter {
  constructor(type?: string);
}

export class BlobReader {
  constructor(blob: Blob);
}

export class ZipReader {
  constructor(reader: BlobReader);
  getEntries(): Promise<ZipEntry[]>;
}

export function configure(options: { useWebWorkers: boolean }): void;
