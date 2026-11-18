import type { BookFile } from "../../foliate-js/src/book";
import { makePDFFixture } from "../fixtures/foliate-pdf";
import { anchorRangeOf } from "./runtime-assertions";

type Modules = {
  pdf: typeof import("../../foliate-js/src/pdf");
  view: typeof import("../../foliate-js/src/view");
  fixed: typeof import("../../foliate-js/src/fixed-layout");
};
type Result = { name: string; passed: boolean; details?: string };

export async function runPDFRegressions(modules: Modules): Promise<Result[]> {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("Run this suite inside Tauri");
  const results: Result[] = [];
  const check = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, details: String(error) });
    }
  };
  const equal = (actual: unknown, expected: unknown) => {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  };
  const waitFor = async (stage: string, condition: () => boolean) => {
    const deadline = Date.now() + 10000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${stage} (window hidden: ${document.hidden})`);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  };
  const bytes = await makePDFFixture();
  const file = new File([bytes], "fixture.pdf", { type: "application/pdf" });

  await check("PDF restores a later page before the first scroll layout", async () => {
    const book = await modules.pdf.makePDF(file);
    const view = new modules.view.View();
    view.style.cssText =
      "display:block;position:fixed;left:0;top:0;width:900px;height:600px;opacity:0;pointer-events:none;z-index:-1";
    document.body.append(view);
    try {
      await view.open(book);
      const renderer = view.renderer;
      if (!(renderer instanceof modules.fixed.FixedLayout)) throw new Error("Wrong renderer");
      renderer.setLayout("scrolled", 1);
      // Do not measure the host or wait for a frame before restoring: the
      // real opening path can arrive before the shadow stylesheet is applied.
      await view.goTo("epubcfi(/6/6)");
      equal(renderer.index, 2);
      equal(view.lastLocation?.section.current, 2);
      if (!renderer.getContents().some((content) => content.index === 2))
        throw new Error("Saved page was not rendered");
    } finally {
      await view.close();
      view.remove();
      await book.destroy();
    }
  });

  await check(
    "PDF: an address inside a page is gone to once the page has its text, and shown from its start",
    async () => {
      // Enough pages that only those near the reader are live.
      const long = new File([await makePDFFixture([600, 800], 20)], "long.pdf", { type: "application/pdf" });
      const book = await modules.pdf.makePDF(long);
      const view = new modules.view.View();
      view.style.cssText =
        "display:block;position:fixed;left:0;top:0;width:900px;height:600px;opacity:0;pointer-events:none;z-index:-1";
      document.body.append(view);
      try {
        await view.open(book);
        const renderer = view.renderer;
        if (!(renderer instanceof modules.fixed.FixedLayout)) throw new Error("Wrong renderer");
        renderer.setLayout("scrolled", 1);
        const target = 18;
        const page = () => renderer.getContents().find((content) => content.index === target)?.doc;
        const lines = () => Array.from(page()?.querySelectorAll(".textLayer span") ?? []);
        await view.goTo(target);
        await waitFor("the target page's text", () => lines().length >= 2);
        // Both typeset lines of the page: one unit of text across a line break.
        const range = page()!.createRange();
        range.setStart(lines()[0].firstChild!, 0);
        range.setEnd(lines()[1].firstChild!, lines()[1].textContent!.length);
        const cfi = view.getCFI(target, range);
        // Far away, the page is torn down; its text is gone with it.
        await view.goTo(0);
        await waitFor("the target page to leave", () => !page());
        await view.goTo(cfi);
        equal(renderer.index, target);
        if (lines().length < 2) throw new Error("The jump returned before the page had its text");
        const host = renderer.getBoundingClientRect();
        const frame = page()!.defaultView!.frameElement!.getBoundingClientRect();
        const top = frame.top + lines()[0].getBoundingClientRect().top - host.top;
        const bottom = frame.top + lines()[1].getBoundingClientRect().bottom - host.top;
        // From its start, a little below the top of the reading area — all of it.
        if (top < 20 || top > 110) throw new Error(`The address was shown ${top}px below the top`);
        if (bottom > renderer.clientHeight) throw new Error(`The address ends ${bottom}px down, out of view`);
        // The same through a zoom: a range gone to on a page already live.
        renderer.setZoom({ fit: "width", factor: 2 });
        await waitFor("the zoomed text", () => lines().length >= 2 && !!lines()[0].firstChild);
        const again = page()!.createRange();
        again.setStart(lines()[0].firstChild!, 0);
        again.setEnd(lines()[1].firstChild!, 3);
        renderer.scrollTop -= 400;
        await renderer.scrollToAnchor(again);
        const zoomedFrame = page()!.defaultView!.frameElement!.getBoundingClientRect();
        const zoomedTop =
          zoomedFrame.top + lines()[0].getBoundingClientRect().top - renderer.getBoundingClientRect().top;
        if (zoomedTop < 20 || zoomedTop > 110)
          throw new Error(`Zoomed, the range was shown ${zoomedTop}px below the top`);
      } finally {
        await view.close();
        view.remove();
        await book.destroy();
      }
    },
  );

  await check("PDF: a wheel the reader claimed over a page does not also scroll the stack", async () => {
    const book = await modules.pdf.makePDF(file);
    const view = new modules.view.View();
    view.style.cssText =
      "display:block;position:fixed;left:0;top:0;width:900px;height:600px;opacity:0;pointer-events:none;z-index:-1";
    document.body.append(view);
    try {
      await view.open(book);
      const renderer = view.renderer;
      if (!(renderer instanceof modules.fixed.FixedLayout)) throw new Error("Wrong renderer");
      renderer.setLayout("scrolled", 1);
      await view.goTo(1);
      const doc = renderer.getContents().find((content) => content.index === 1)?.doc;
      if (!doc) throw new Error("The page is not live");
      const WheelEventOfPage = (doc.defaultView as Window & typeof globalThis).WheelEvent;
      const wheel = () =>
        doc.body.dispatchEvent(new WheelEventOfPage("wheel", { deltaY: 90, bubbles: true, cancelable: true }));
      const top = renderer.scrollTop;
      wheel();
      equal(renderer.scrollTop, top + 90);
      // A listener on the page's document — where the reader puts its own —
      // is asked before the stack scrolls.
      const claim = (event: Event) => event.preventDefault();
      doc.addEventListener("wheel", claim, { passive: false });
      wheel();
      doc.removeEventListener("wheel", claim);
      equal(renderer.scrollTop, top + 90);
    } finally {
      await view.close();
      view.remove();
      await book.destroy();
    }
  });

  await check("PDF parses through byte ranges, extracts text and resolves outline sections", async () => {
    let slices = 0;
    const source: BookFile = {
      name: file.name,
      size: file.size,
      type: file.type,
      arrayBuffer: () => {
        throw new Error("Whole-file reads are not allowed");
      },
      slice: (start, end, type) => {
        slices++;
        return file.slice(start, end, type);
      },
    };
    const book = await modules.pdf.makePDF(source);
    let pageURL: string | undefined;
    try {
      equal(book.metadata.title, "PDF Engine Fixture");
      equal(book.sections.length, 3);
      equal(await book.sections[1].getText(), "Hello PDF world\nGo to final chapter");
      const [chapterHref, firstHref] = [book.toc?.[1]?.href, book.toc?.[0]?.href];
      if (!chapterHref || !firstHref) throw new Error("PDF outline entries have no destinations");
      equal((await book.resolveHref(chapterHref))?.index, 2);
      equal((await book.splitTOCHref(firstHref))?.[0], "page:2");
      if (slices < 1) throw new Error("Range transport was not used");
      const [a, b] = await Promise.all([book.sections[1].load(), book.sections[1].load()]);
      equal(a.src, b.src);
      pageURL = a.src;
      const cover = await book.getCover();
      equal(cover?.type, "image/png");
      if (!cover || cover.size < 100) throw new Error("Leading blank leaf hid the cover");
    } finally {
      await book.destroy();
    }
    let revoked = false;
    try {
      await fetch(pageURL!);
    } catch {
      revoked = true;
    }
    equal(revoked, true);
  });

  await check("PDF raster, CFI, annotations and dark palette survive redraws", async () => {
    const book = await modules.pdf.makePDF(file);
    const view = new modules.view.View();
    view.style.cssText =
      "display:block;position:fixed;left:0;top:0;width:900px;height:600px;opacity:0;pointer-events:none;z-index:-1";
    document.body.append(view);
    try {
      await view.open(book);
      const renderer = view.renderer;
      if (!(renderer instanceof modules.fixed.FixedLayout)) throw new Error("Wrong renderer");
      renderer.setLayout("paginated", 1);
      await view.goTo(1);
      const content = () => renderer.getContents().find((content) => content.index === 1);
      await waitFor("initial PDF raster and text", () => !!content()?.doc.querySelector(".textLayer span"));
      const doc = content()!.doc;
      const text = Array.from(doc.querySelectorAll(".textLayer span")).find(
        (span) => span.textContent === "Hello PDF world",
      )?.firstChild;
      if (!text) throw new Error("PDF text layer is missing fixture text");
      const range = doc.createRange();
      range.setStart(text, 10);
      range.setEnd(text, 15);
      const cfi = view.getCFI(1, range);
      equal(anchorRangeOf(view.resolveCFI(cfi), doc).toString(), "world");
      const originalCount = doc.querySelectorAll(".textLayer span").length;
      const original = doc.querySelector("canvas");
      if (!original) throw new Error("PDF has no canvas");
      const pixels = original.getContext("2d")?.getImageData(0, 0, original.width, original.height).data;
      if (!pixels?.some((value, i) => i % 4 !== 3 && value < 80)) throw new Error("Blank PDF raster");
      renderer.setPageColors({ background: "#101010", foreground: "#eeeeee" });
      await waitFor(
        "PDF palette redraw",
        () =>
          doc.querySelector("canvas") !== original && doc.querySelectorAll(".textLayer span").length === originalCount,
      );
      equal(anchorRangeOf(view.resolveCFI(cfi), doc).toString(), "world");
      const canvas = doc.querySelector("canvas")!;
      const background = canvas.getContext("2d")!.getImageData(5, 5, 1, 1).data;
      if (Math.abs(background[0] - 16) > 2) throw new Error(`Wrong painted PDF background: ${background[0]}`);
      const link = doc.querySelector<HTMLAnchorElement>(".annotationLayer a");
      if (!link) throw new Error("PDF link annotation is missing");
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await waitFor("PDF link navigation", () => renderer.index === 2);
    } finally {
      await view.close();
      view.remove();
      await book.destroy();
    }
  });

  for (const synchronous of [false, true])
    await check(
      `PDF ${synchronous ? "synchronous" : "asynchronous"} range read failures reject instead of hanging`,
      async () => {
        const source: BookFile = {
          name: "broken.pdf",
          size: file.size,
          type: "application/pdf",
          arrayBuffer: () => {
            const error = new Error("Expected fixture read failure");
            if (synchronous) throw error;
            return Promise.reject(error);
          },
          slice: () => source,
        };
        let failed = false;
        try {
          const book = await modules.pdf.makePDF(source);
          await book.destroy();
        } catch (error) {
          failed = String(error).includes("Expected fixture read failure");
        }
        equal(failed, true);
      },
    );
  return results;
}
