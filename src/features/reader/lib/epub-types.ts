export type EpubRelocation = {
  start?: {
    cfi?: string;
    href?: string;
  };
};

export type EpubNavigationItem = {
  id?: string;
  href?: string;
  label?: string;
  subitems?: EpubNavigationItem[];
};

export type EpubNavigation = {
  toc?: EpubNavigationItem[];
};

export type EpubRenderedView = {
  element?: HTMLElement | null;
};

export type EpubContents = {
  addStylesheetCss: (serializedCss: string, key: string) => Promise<boolean>;
  cfiFromRange: (range: Range, ignoreClass?: string) => string;
  document: Document;
  window: Window;
};

export type EpubRendition = {
  display: (target?: string) => Promise<unknown>;
  next: () => Promise<unknown>;
  prev: () => Promise<unknown>;
  on: {
    (event: "relocated", listener: (location: EpubRelocation) => void): void;
    (event: "rendered", listener: (section: unknown, view: EpubRenderedView) => void): void;
    (event: "selected", listener: (cfiRange: string, contents: EpubContents) => void): void;
    (event: string, listener: (...args: unknown[]) => void): void;
  };
  off: {
    (event: "relocated", listener: (location: EpubRelocation) => void): void;
    (event: "rendered", listener: (section: unknown, view: EpubRenderedView) => void): void;
    (event: "selected", listener: (cfiRange: string, contents: EpubContents) => void): void;
    (event: string, listener: (...args: unknown[]) => void): void;
  };
  resize: () => void;
  destroy: () => void;
  hooks: {
    content: {
      register: (handler: (contents: EpubContents, view: unknown) => void | Promise<unknown>) => void;
    };
  };
  annotations: {
    highlight: (
      cfiRange: string,
      data?: Record<string, unknown>,
      cb?: (e: MouseEvent) => void,
      className?: string,
      styles?: Record<string, string>,
    ) => void;
    remove: (cfiRange: string, type: string) => void;
  };
};

export type EpubBook = {
  renderTo: (element: HTMLElement, options: Record<string, unknown>) => EpubRendition;
  ready: Promise<unknown>;
  loaded: {
    navigation: Promise<EpubNavigation>;
  };
  load: (path: string) => Promise<Document>;
  section: (target: string | number) => { href: string; index: number } | null;
  spine: {
    each: (handler: (section: { href: string; index: number }) => void) => void;
  };
  destroy: () => void;
};

export type EpubFactory = (source: ArrayBuffer | string) => EpubBook;

export type LoadedEpub = {
  fileName: string;
  data: ArrayBuffer;
};

export type TocEntry = {
  id: string;
  href: string;
  label: string;
  depth: number;
  spineIndex: number;
};

export type SpineEntry = {
  href: string;
  index: number;
};
