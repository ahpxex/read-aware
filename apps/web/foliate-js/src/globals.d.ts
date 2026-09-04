interface Window {
  __readawareFoliate?: {
    makeBook: typeof import("./view.js").makeBook;
    Overlayer: typeof import("./overlayer.js").Overlayer;
    FootnoteHandler: typeof import("./footnotes.js").FootnoteHandler;
  };
}
