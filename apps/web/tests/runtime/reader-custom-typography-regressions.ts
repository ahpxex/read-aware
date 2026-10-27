import type { Paginator } from "../../foliate-js/src/paginator";
import {
  buildReaderContentCss,
  computeReaderMaxInlineSize,
  layoutForReadingMode,
  readerLayoutSpacing,
} from "../../src/features/settings/lib/reader-css";
import { DEFAULT_READER_SETTINGS, type ReaderSettings } from "../../src/features/settings/lib/reader-settings";
import { BUILTIN_READER_PALETTES } from "../../src/features/settings/lib/reader-theme";

type Result = { name: string; passed: boolean; details?: string };

/** Custom typography through the real paginator: measured margins and indent. */
export async function runCustomTypographyRegressions(PaginatorClass: typeof Paginator): Promise<Result[]> {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("Run this suite inside foreground Tauri");
  const results: Result[] = [];
  const assert = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message);
  };
  const custom = (extra: Partial<ReaderSettings["customTypography"] & object> = {}): ReaderSettings => ({
    ...DEFAULT_READER_SETTINGS,
    typographyMode: "custom",
    customTypography: {
      fontSizePx: 20,
      lineHeight: 1.7,
      paragraphSpacingEm: 0.8,
      pageMarginPercent: 10,
      textIndentEm: null,
      ...extra,
    },
  });
  const run = async (
    name: string,
    settings: ReaderSettings,
    mode: ReaderSettings["readingMode"],
    publisherCss: string,
    check: (doc: Document, frameLeft: number) => void,
  ) => {
    const renderer = new PaginatorClass();
    renderer.style.cssText =
      "display:block;position:fixed;left:0;top:0;width:1200px;height:800px;opacity:0;pointer-events:none;z-index:-1";
    document.body.append(renderer);
    const url = URL.createObjectURL(
      new Blob(
        [
          `<!doctype html><html><head><style>${publisherCss}</style></head><body><p id="prose">${"Four score and seven years ago our fathers brought forth. ".repeat(120)}</p></body></html>`,
        ],
        { type: "text/html" },
      ),
    );
    try {
      const { flow, maxColumnCount } = layoutForReadingMode(mode);
      const spacing = readerLayoutSpacing(settings, mode);
      const columns = maxColumnCount;
      renderer.setLayoutAttributes({
        flow,
        gap: spacing.gap,
        margin: spacing.margin,
        "max-column-count": String(maxColumnCount),
        "max-inline-size": `${computeReaderMaxInlineSize(settings, 1200, columns)}px`,
      });
      renderer.setStyles(buildReaderContentCss(settings, { palette: BUILTIN_READER_PALETTES.warm }));
      renderer.open({ sections: [{ id: 0, size: 100, load: () => url }] });
      await renderer.goTo({ index: 0 });
      const doc = renderer.getContents()[0]!.doc;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      check(doc, (doc.defaultView!.frameElement as HTMLElement).getBoundingClientRect().left);
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, details: String(error) });
    } finally {
      renderer.destroy();
      renderer.remove();
      URL.revokeObjectURL(url);
    }
  };

  for (const mode of ["paginated-single", "paginated-double", "scroll"] as const) {
    await run(
      `${mode}: custom pageMarginPercent lands the measured outer margin at 10% ± 1.5`,
      custom({ pageMarginPercent: 10 }),
      mode,
      "",
      (doc, frameLeft) => {
        const textLeft = doc.getElementById("prose")!.getBoundingClientRect().left;
        const marginPercent = ((frameLeft + textLeft) / 1200) * 100;
        assert(
          Math.abs(marginPercent - 10) <= 1.5,
          `Outer margin ${marginPercent.toFixed(2)}% is not ≈10% of the reader width`,
        );
      },
    );
  }
  await run(
    "paginated-single: custom textIndent reaches computed style at 2×font-size",
    custom({ textIndentEm: 2 }),
    "paginated-single",
    "",
    (doc) => {
      const win = doc.defaultView!;
      const p = doc.getElementById("prose")!;
      const indent = parseFloat(win.getComputedStyle(p).textIndent);
      const fontSize = parseFloat(win.getComputedStyle(p).fontSize);
      assert(Math.abs(indent - fontSize * 2) < 0.5, `text-indent ${indent} ≠ 2×${fontSize}`);
    },
  );
  await run(
    "paginated-single: book indent leaves a publisher text-indent intact",
    { ...DEFAULT_READER_SETTINGS, textIndent: "book" },
    "paginated-single",
    "p { text-indent: 3em; }",
    (doc) => {
      const win = doc.defaultView!;
      const p = doc.getElementById("prose")!;
      const indent = parseFloat(win.getComputedStyle(p).textIndent);
      const fontSize = parseFloat(win.getComputedStyle(p).fontSize);
      assert(Math.abs(indent - fontSize * 3) < 0.5, `Publisher indent flattened: ${indent} ≠ 3×${fontSize}`);
    },
  );
  return results;
}
