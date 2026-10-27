import type { Book } from "../../foliate-js/src/book";
import { buildChapterMap } from "../../foliate-js/src/chapter-map";
import type { View } from "../../foliate-js/src/view";
import type { LoadDetail } from "../../foliate-js/src/renderer";
import {
  markReaderChapterStarts,
  markReaderInlineMedia,
  normalizeReaderTextSizes,
  readerChapterStarts,
} from "../../src/features/reader/lib/reader-document-layout";
import { buildReaderContentCss, readerLayoutSpacing } from "../../src/features/settings/lib/reader-css";
import { DEFAULT_READER_SETTINGS } from "../../src/features/settings/lib/reader-settings";
import { BUILTIN_READER_PALETTES } from "../../src/features/settings/lib/reader-theme";

type Result = { name: string; passed: boolean; details?: string };

export async function runDocumentLayoutRegressions(ViewClass: typeof View): Promise<Result[]> {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("Run inside foreground Tauri");
  const results: Result[] = [];
  const assert = (value: boolean, message: string) => {
    if (!value) throw new Error(message);
  };
  const markup = `<!doctype html><html><head><style>
    .tiny {font-size:.41667em} .nested {font-size:.5em} .title {font-size:1.66667em}
    .compensated {font-size:1.8em} .shrink {font-size:.77778em} .expand {font-size:1.28571em}
    .fixed {font-size:16px} .ordinary {font-size:.9em}
  </style></head><body>
    <p id="one"><span class="title"><strong>Chapter one</strong></span></p>
    <p id="prose">Normal reading text.</p>
    <p class="tiny"><span id="quote">A long quotation <strong id="emphasis">with emphasis</strong>.
      <sup class="compensated"><small class="shrink"><span class="expand" id="reference">[2-26]</span></small></sup>
    </span></p>
    <p class="tiny"><span class="nested" id="nested">A nested small note.</span></p>
    <p><span class="ordinary" id="ordinary">Ordinary small print.</span></p>
    <p><span class="fixed" id="fixed">Fixed-size publisher text.</span></p>
    <p><span style="font-size:.5em;vertical-align:super" id="raised">1</span>
      <math><mtext style="font-size:8px" id="math">x</mtext></math></p>
    <p id="endnotes" class="tiny"><span id="note">End of chapter notes.</span></p>
    <a id="two"></a><p id="heading"><span class="title"><strong>Chapter two</strong></span></p>
    <p id="minor">A subsection stays within its chapter.</p><p>${"Reading content. ".repeat(200)}</p>
  </body></html>`;

  for (const mode of ["paginated-double", "paginated-single", "scroll"] as const) {
    const view = new ViewClass();
    view.style.cssText =
      "display:block;position:fixed;left:0;top:0;width:1200px;height:800px;opacity:0;pointer-events:none;z-index:-1";
    document.body.append(view);
    const url = URL.createObjectURL(new Blob([markup], { type: "text/html" }));
    const book: Book = {
      sections: [{ id: "file", size: 1000, load: () => url }],
      toc: [
        { label: "One", href: "one" },
        { label: "Two", href: "two", subitems: [{ label: "Minor", href: "minor" }] },
      ],
      resolveHref: async (href) => ({ index: 0, anchor: (doc) => doc.getElementById(href) }),
      splitTOCHref: (href) => ["file", href],
      getTOCFragment: (doc, fragment) => (typeof fragment === "string" ? doc.getElementById(fragment) : null),
    };
    try {
      const starts = readerChapterStarts(book, await buildChapterMap(book));
      let cfiBefore = "";
      const quoteRange = (doc: Document) => {
        const range = doc.createRange();
        range.selectNodeContents(doc.getElementById("quote")!);
        return range;
      };
      view.addEventListener("load", (event) => {
        const { doc, index } = (event as CustomEvent<LoadDetail>).detail;
        cfiBefore = view.getCFI(index, quoteRange(doc));
        markReaderChapterStarts(doc, index, starts);
        markReaderInlineMedia(doc);
        normalizeReaderTextSizes(doc);
      });
      await view.open(book);
      const renderer = view.renderer;
      if (!renderer || !("setStyles" in renderer)) throw new Error("Missing paginator");
      renderer.setChapterStarts(starts);
      const spacing = readerLayoutSpacing("wide", mode);
      renderer.setLayoutAttributes({
        flow: mode === "scroll" ? "scrolled" : "paginated",
        margin: spacing.margin,
        gap: spacing.gap,
        "max-column-count": mode === "paginated-double" ? "2" : "1",
        "max-inline-size": "960px",
      });
      const css = (large = false) =>
        buildReaderContentCss(
          {
            ...DEFAULT_READER_SETTINGS,
            fontFamily: "system:serif",
            readingMode: mode,
            fontSize: large ? "x-large" : "medium",
          },
          { palette: BUILTIN_READER_PALETTES.warm },
        );
      renderer.setStyles(css());
      await view.goTo(0);
      const doc = renderer.getContents()[0]!.doc,
        win = doc.defaultView!;
      const el = (id: string) => doc.getElementById(id)!;
      const size = (id: string) => parseFloat(win.getComputedStyle(el(id)).fontSize);
      const settle = async () => {
        await doc.fonts.ready;
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      };
      await settle();
      const bodySize = parseFloat(win.getComputedStyle(doc.body).fontSize);
      for (const id of ["quote", "nested", "note"])
        assert(size(id) >= bodySize * 0.85 - 0.02, `${id} remains unreadably small: ${size(id)}`);
      assert(
        size("reference") < size("quote") && size("reference") > size("quote") * 0.7,
        "Superscript compensation is distorted",
      );
      assert(parseFloat(win.getComputedStyle(el("emphasis")).fontWeight) >= 600, "Emphasis was lost");
      assert(
        !el("ordinary").hasAttribute("data-ra-small-text") && size("ordinary") > size("note"),
        "Legible publisher sizing was flattened",
      );
      assert(!el("fixed").hasAttribute("data-ra-small-text"), "Legible fixed type was unnecessarily changed");
      assert(!el("math").hasAttribute("data-ra-small-text") && size("math") === 8, "Math typography was changed");
      assert(!el("raised").hasAttribute("data-ra-small-text"), "CSS superscript was mistaken for reading text");
      assert(
        el("one").getAttribute("data-ra-chapter-start") === "first",
        "First chapter acquired a blank opening page",
      );
      assert(
        el("two").getAttribute("data-ra-chapter-start") === "next",
        "Standalone chapter anchor did not acquire a boundary",
      );
      assert(!el("minor").hasAttribute("data-ra-chapter-start"), "Subsection became a chapter break");
      const previous = el("endnotes").getBoundingClientRect(),
        heading = el("heading").getBoundingClientRect();
      if (mode === "scroll") assert(heading.top - previous.bottom >= 60, "Scrolled chapters still run together");
      else assert(heading.left > previous.right && heading.top < 100, "Next chapter did not start a new column");
      assert(
        Math.abs(el("two").getBoundingClientRect().left - heading.left) < 1,
        "TOC anchor was stranded before the chapter break",
      );
      assert(view.getCFI(0, quoteRange(doc)) === cfiBefore, "Layout correction changed CFI paths");
      renderer.setStyles(css(true));
      normalizeReaderTextSizes(doc);
      await settle();
      assert(
        el("fixed").hasAttribute("data-ra-small-text") &&
          size("fixed") >= parseFloat(win.getComputedStyle(doc.body).fontSize) * 0.85 - 0.02,
        "Font-size changes did not update the readability floor",
      );
      const current = size("quote");
      normalizeReaderTextSizes(doc);
      normalizeReaderTextSizes(doc);
      assert(size("quote") === current, "Repeated normalization compounds font sizes");
      await view.goTo("two");
      const visible = view.lastLocation?.range?.toString().trim() ?? "";
      assert(
        visible.includes("Chapter two"),
        `TOC navigation did not reveal the chapter heading: ${visible.slice(0, 80)}`,
      );
      assert(visible.startsWith("Chapter two"), "TOC navigation landed before the chapter break");
      results.push({
        name: `${mode}: chapter boundaries, readable notes/quotes, typography updates and stable CFI`,
        passed: true,
      });
    } catch (error) {
      results.push({ name: mode, passed: false, details: String(error) });
    } finally {
      await view.close();
      view.remove();
      URL.revokeObjectURL(url);
    }
  }
  return results;
}
