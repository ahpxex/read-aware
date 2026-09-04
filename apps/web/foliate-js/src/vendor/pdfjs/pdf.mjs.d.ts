declare global {
  var pdfjsLib: {
    GlobalWorkerOptions: { workerSrc: string };
    AnnotationMode: { ENABLE: number };
    stopEvent(event: Event): void;
    PDFDataRangeTransport: new (
      length: number,
      initialData: Uint8Array | never[],
      progressiveDone?: boolean,
    ) => {
      requestDataRange(begin: number, end: number): void;
      onDataRange(begin: number, chunk: ArrayBuffer): void;
    };
    TextLayer: new (options: Record<string, unknown>) => {
      render(): Promise<void>;
      cancel(): void;
    };
    AnnotationLayer: new (options: Record<string, unknown>) => {
      render(options: Record<string, unknown>): Promise<void>;
    };
    getDocument(options: Record<string, unknown>): { promise: Promise<any> };
  };
}

export {};
