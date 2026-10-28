import type { Paginator } from "../../foliate-js/src/paginator";
import { markReaderInlineMedia } from "../../src/features/reader/lib/reader-document-layout";
import { buildReaderContentCss, readerLayoutSpacing } from "../../src/features/settings/lib/reader-css";
import { DEFAULT_READER_SETTINGS, type ReadingMode } from "../../src/features/settings/lib/reader-settings";
import { BUILTIN_READER_PALETTES } from "../../src/features/settings/lib/reader-theme";

type Result = { name: string; passed: boolean; details?: string };

/** Real WebKit columns are essential: DOM mocks cannot reproduce SVG fragments. */
export async function runMediaRegressions(PaginatorClass: typeof Paginator): Promise<Result[]> {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("Run this suite inside foreground Tauri");
  const results: Result[] = [];
  const assert = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message);
  };
  const canvas = document.createElement("canvas");
  canvas.width = 465;
  canvas.height = 719;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Missing fixture canvas");
  context.fillStyle = "#753";
  context.fillRect(0, 0, 465, 719);
  const source = canvas.toDataURL();
  const picture = `<img alt="Cover" src="${source}">`;
  const covers = {
    svg: `<div><svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 465 719"><title>Cover artwork</title><image width="465" height="719" href="${source}"/></svg></div>`,
    table: `<div></div><div>&nbsp;</div><div><table><tr><td>${picture}</td></tr></table></div><div style="page-break-after:always"></div>`,
  };
  const css = (mode: ReadingMode, large = false) =>
    buildReaderContentCss(
      {
        ...DEFAULT_READER_SETTINGS,
        fontFamily: "system:serif",
        readingMode: mode,
        ...(large ? ({ fontSize: "x-large", pageMargins: "narrow" } as const) : {}),
      },
      { palette: BUILTIN_READER_PALETTES.warm },
    );
  const settle = async (doc: Document) => {
    await doc.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  };
  const fits = (doc: Document, paginated: boolean) => {
    const image = doc.querySelector("img, svg");
    if (!image) throw new Error("Missing artwork");
    const rects = Array.from(image.getClientRects());
    assert(rects.length === 1, `Artwork fragmented into ${rects.length} columns`);
    const rect = rects[0]!;
    assert(rect.width > 100 && rect.height > 100, "Artwork disappeared or collapsed");
    assert(Math.abs(rect.width / rect.height - 465 / 719) < 0.01, "Artwork aspect ratio changed");
    if (paginated) {
      assert(
        rect.top >= 0 && rect.bottom <= doc.documentElement.clientHeight + 0.5,
        `Artwork exceeds page height: ${JSON.stringify(rect)}`,
      );
      assert(doc.body.getClientRects().length === 1, "Image-only page has an extra blank column");
    }
  };
  const run = async (
    name: string,
    markup: string,
    mode: ReadingMode,
    check: (renderer: Paginator, doc: Document) => Promise<void>,
  ) => {
    const renderer = new PaginatorClass();
    renderer.style.cssText =
      "display:block;position:fixed;left:0;top:0;width:1200px;height:800px;opacity:0;pointer-events:none;z-index:-1";
    document.body.append(renderer);
    const url = URL.createObjectURL(
      new Blob(
        [
          `<!doctype html><html><head><style>table { border-spacing:2px } td { padding:1px }</style></head><body>${markup}</body></html>`,
        ],
        { type: "text/html" },
      ),
    );
    try {
      const spacing = readerLayoutSpacing({ ...DEFAULT_READER_SETTINGS, pageMargins: "wide" }, mode);
      renderer.setLayoutAttributes({
        flow: mode === "scroll" ? "scrolled" : "paginated",
        margin: spacing.margin,
        gap: spacing.gap,
        "max-column-count": mode === "paginated-double" ? "2" : "1",
        "max-inline-size": "960px",
      });
      renderer.setStyles(css(mode));
      renderer.open({ sections: [{ id: 0, size: 100, load: () => url }] });
      await renderer.goTo({ index: 0 });
      const doc = renderer.getContents()[0]!.doc;
      await settle(doc);
      await check(renderer, doc);
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, details: String(error) });
    } finally {
      renderer.destroy();
      renderer.remove();
      URL.revokeObjectURL(url);
    }
  };

  for (const mode of ["paginated-double", "paginated-single", "scroll"] as const) {
    for (const [kind, markup] of Object.entries(covers)) {
      await run(
        `${mode}: ${kind} cover fits without blank fragments or layout-table borders`,
        markup,
        mode,
        async (renderer, doc) => {
          assert(doc.documentElement.hasAttribute("data-foliate-image-page"), "Image-only document was not recognized");
          fits(doc, mode !== "scroll");
          const cell = doc.querySelector("td");
          if (cell)
            assert(
              doc.defaultView!.getComputedStyle(cell).borderTopWidth === "0px",
              "Cover wrapper has a table border",
            );
          // Typography and dimensions change after the original iframe load.
          renderer.setStyles(css(mode, true));
          await settle(doc);
          fits(doc, mode !== "scroll");
          renderer.style.height = "480px";
          renderer.render();
          await settle(doc);
          fits(doc, mode !== "scroll");
          renderer.style.height = "800px";
          renderer.render();
          await settle(doc);
          fits(doc, mode !== "scroll");
        },
      );
    }
  }
  await run(
    "ordinary illustrations reserve their margins and data tables keep their borders",
    `<figure>${picture}<figcaption>Figure caption</figcaption></figure><table><tr><td>Actual data</td></tr></table>`,
    "paginated-double",
    async (renderer, doc) => {
      assert(!doc.documentElement.hasAttribute("data-foliate-image-page"), "Text page was mistaken for a cover");
      const img = doc.querySelector("img")!;
      const limit = () => parseFloat(img.style.maxHeight);
      const before = limit();
      assert(img.getClientRects().length === 1, "Ordinary illustration fragmented");
      assert(
        doc.defaultView!.getComputedStyle(doc.querySelector("td")!).borderTopWidth === "1px",
        "Data table lost its border",
      );
      assert(
        doc.defaultView!.getComputedStyle(doc.querySelector("figcaption")!).display !== "none",
        "Caption was hidden",
      );
      renderer.setStyles(
        `${css("paginated-double")} body { padding-top: 100px !important; } img { margin-block: 40px !important; }`,
      );
      await settle(doc);
      assert(limit() < before - 80, "Image size did not respond to changed content spacing");
      assert(img.getClientRects().length === 1, "Style update split the illustration");
      const current = limit();
      renderer.render();
      renderer.render();
      assert(limit() === current, "Repeated layout progressively shrinks the image");
    },
  );
  // 补字图: a ~34×37 JPEG standing in for a rare glyph inside a line of text
  // (葛兆光《唐诗选注》, publisher rule img.pic-s { height: 1em; vertical-align:
  // middle }). Forcing it into a centered block tears the sentence apart.
  const glyphCanvas = document.createElement("canvas");
  glyphCanvas.width = 34;
  glyphCanvas.height = 37;
  glyphCanvas.getContext("2d")?.fillRect(0, 0, 34, 37);
  const glyph = glyphCanvas.toDataURL();
  await run(
    "inline glyph images keep publisher sizing and stay on the text line",
    `<style>img.pic-s { height: 1em; vertical-align: middle; }</style>
    <p id="prose">淑气催黄鸟，晴光转绿<img class="pic-s" alt="" src="${glyph}">指绿色的<img class="pic-s" alt="" src="${glyph}">草，梁代诗人江淹有“东风转绿”句。</p>
    <p id="solo"><img alt="" src="${source}"></p>
    <p id="separated">Caption above<br><img alt="" src="${source}"></p>`,
    "paginated-double",
    async (_renderer, doc) => {
      const win = doc.defaultView!;
      const prose = doc.getElementById("prose")!;
      const glyphs = [...prose.querySelectorAll("img.pic-s")];
      assert(glyphs.length === 2, "Missing glyph fixture");
      markReaderInlineMedia(doc);
      const marked = () => doc.querySelectorAll("[data-ra-inline-media]").length;
      const count = marked();
      markReaderInlineMedia(doc);
      assert(marked() === count, "Repeated inline-media marking changed the classification");
      const fontSize = parseFloat(win.getComputedStyle(prose).fontSize);
      const sharesLine = (img: Element) => {
        const rect = img.getBoundingClientRect();
        for (const sibling of [img.previousSibling, img.nextSibling]) {
          if (sibling?.nodeType !== Node.TEXT_NODE || !sibling.textContent?.trim()) continue;
          const range = doc.createRange();
          range.selectNodeContents(sibling);
          for (const text of range.getClientRects()) {
            const sameLine = text.top < rect.bottom && text.bottom > rect.top;
            const abuts =
              (text.left < rect.left && rect.left - text.right < fontSize) ||
              (text.left >= rect.right && text.left - rect.right < fontSize);
            if (sameLine && abuts) return true;
          }
        }
        return false;
      };
      for (const img of glyphs) {
        assert(img.hasAttribute("data-ra-inline-media"), "Glyph image on a text line was not marked");
        assert(
          win.getComputedStyle(img).display === "inline",
          `Inline glyph was still forced into a block: ${win.getComputedStyle(img).display}`,
        );
        const rect = img.getBoundingClientRect();
        assert(
          Math.abs(rect.height - fontSize) <= 1,
          `Publisher em sizing lost: height ${rect.height} vs font-size ${fontSize}`,
        );
        assert(sharesLine(img), "Inline glyph was split off its text line");
      }
      for (const id of ["solo", "separated"]) {
        const img = doc.getElementById(id)!.querySelector("img")!;
        assert(!img.hasAttribute("data-ra-inline-media"), `Illustration in #${id} was mistaken for inline media`);
        assert(win.getComputedStyle(img).display === "block", `Illustration in #${id} lost its block treatment`);
      }
    },
  );
  return results;
}
