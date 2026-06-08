export type PdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
  destroy: () => void;
};

export type PdfPage = {
  getViewport: (params: { scale: number }) => PdfViewport;
  render: (params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
  }) => { promise: Promise<void>; cancel: () => void };
  getTextContent: () => Promise<PdfTextContent>;
  cleanup: () => boolean;
};

export type PdfViewport = {
  width: number;
  height: number;
};

export type PdfTextContent = {
  items: unknown[];
  styles: Record<string, unknown>;
};

export type PdfTextLayerConstructor = new (params: {
  textContentSource: PdfTextContent;
  container: HTMLElement;
  viewport: PdfViewport;
}) => { render: () => Promise<void>; cancel: () => void };

export type PdfLoadingTask = {
  promise: Promise<PdfDocument>;
  destroy: () => void;
};

export type LoadedPdf = {
  fileName: string;
  data: ArrayBuffer;
};

export type PageDimensions = {
  width: number;
  height: number;
};
