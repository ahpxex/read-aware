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

export function configure(options: { useWebWorkers: boolean }): void;
