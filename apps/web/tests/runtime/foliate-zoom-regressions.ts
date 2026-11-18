import type { FixedLayout } from "../../foliate-js/src/fixed-layout";
import { makePDFFixture } from "../fixtures/foliate-pdf";

type Modules = {
  pdf: typeof import("../../foliate-js/src/pdf");
  view: typeof import("../../foliate-js/src/view");
  fixed: typeof import("../../foliate-js/src/fixed-layout");
};
type Result = { name: string; passed: boolean; details?: string };

const WIDTH = 900;
const HEIGHT = 600;
// Fixture pages are 600 × 800 page units.
const PAGE = { width: 600, height: 800 };

/** Fixed-layout zoom: fit and factor, overflow reach, anchoring, live presentation and the sharp overlay. */
export async function runZoomRegressions(modules: Modules): Promise<Result[]> {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("Run this suite inside Tauri");
  const results: Result[] = [];
  const check = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
      results.push({ name, passed: true });
    } catch (error) {
      results.push({
        name,
        passed: false,
        details: error instanceof Error ? (error.stack ?? error.message) : String(error),
      });
    }
  };
  const near = (actual: number, expected: number, what: string, tolerance = 1.5) => {
    if (Math.abs(actual - expected) > tolerance) throw new Error(`${what}: expected ${expected}, received ${actual}`);
  };
  const assert = (value: boolean, message: string) => {
    if (!value) throw new Error(message);
  };
  const waitFor = async (stage: string, condition: () => boolean, timeout = 10000) => {
    const deadline = Date.now() + timeout;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${stage} (window hidden: ${document.hidden})`);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  };
  const file = new File([await makePDFFixture()], "fixture.pdf", { type: "application/pdf" });
  // The same pages lying on their side, for what depends on a page's shape.
  const landscapeFile = new File([await makePDFFixture([PAGE.height, PAGE.width])], "landscape.pdf", {
    type: "application/pdf",
  });

  const open = async (
    flow: "scrolled" | "paginated",
    index = 1,
    {
      source = file,
      columns = 1,
      prepare,
    }: { source?: File; columns?: number; prepare?: (renderer: FixedLayout) => void } = {},
  ) => {
    const book = await modules.pdf.makePDF(source);
    const view = new modules.view.View();
    view.style.cssText = `display:block;position:fixed;left:0;top:0;width:${WIDTH}px;height:${HEIGHT}px;opacity:0;pointer-events:none;z-index:-1`;
    document.body.append(view);
    await view.open(book);
    const renderer = view.renderer;
    if (!(renderer instanceof modules.fixed.FixedLayout)) throw new Error("Wrong renderer");
    renderer.setLayout(flow, columns);
    // As the app sets a book's remembered view up: before its first page shows.
    prepare?.(renderer as FixedLayout);
    await view.goTo(index);
    const page = (i = index) => renderer.getContents().find((content) => content.index === i)?.doc;
    await waitFor("first raster", () => !!page()?.querySelector(".textLayer span"));
    return {
      renderer: renderer as FixedLayout,
      page,
      /** The page's box on screen, in client coordinates. */
      box: (i = index) => {
        const frame = page(i)?.defaultView?.frameElement;
        if (!frame) throw new Error(`Page ${i} is not live`);
        return frame.getBoundingClientRect();
      },
      host: () => renderer.getBoundingClientRect(),
      close: async () => {
        await view.close();
        view.remove();
        await book.destroy();
      },
    };
  };
  const pageScale = (doc: Document | undefined) => {
    const canvas = doc?.querySelector<HTMLCanvasElement>("#canvas > canvas:not([data-detail])");
    const frame = doc?.defaultView?.frameElement;
    if (!canvas || !frame) return 0;
    // The raster presented at the frame's layout size, in CSS px per page unit.
    return canvas.getBoundingClientRect().width / PAGE.width;
  };

  await check("scrolled fit-width pages zoom by the factor and stay reachable from their left edge", async () => {
    const reader = await open("scrolled");
    try {
      const { renderer } = reader;
      const width = renderer.clientWidth;
      near(reader.box().width, width, "fit-width page width");
      renderer.setZoom({ fit: "auto", factor: 2 });
      near(reader.box().width, width * 2, "zoomed page width");
      assert(renderer.scrollWidth >= width * 2 - 1, `Host cannot scroll across the page (${renderer.scrollWidth})`);
      renderer.scrollLeft = 0;
      near(reader.box().left, reader.host().left, "page left edge at scroll start");
      renderer.scrollLeft = renderer.scrollWidth;
      near(reader.box().right, reader.host().left + width, "page right edge at scroll end");
      await waitFor(
        "raster at the zoomed scale",
        () => Math.abs(pageScale(reader.page()) - (width * 2) / PAGE.width) < 0.01,
      );
    } finally {
      await reader.close();
    }
  });

  await check("scrolled fit-page fits the whole page in the viewport", async () => {
    const reader = await open("scrolled");
    try {
      const { renderer } = reader;
      renderer.setZoom({ fit: "page", factor: 1 });
      near(reader.box().height, renderer.clientHeight, "fit-page height");
      near(reader.box().width, (renderer.clientHeight * PAGE.width) / PAGE.height, "fit-page width");
      // Narrower than the viewport: centered, nothing to scroll sideways.
      near(reader.box().left - reader.host().left, (renderer.clientWidth - reader.box().width) / 2, "centered page");
      assert(renderer.scrollWidth <= renderer.clientWidth + 1, "A fitting page overflowed sideways");
    } finally {
      await reader.close();
    }
  });

  await check("a zoom keeps the page point under its anchor still", async () => {
    for (const flow of ["scrolled", "paginated"] as const) {
      const reader = await open(flow);
      try {
        const { renderer } = reader;
        renderer.setZoom({ fit: "width", factor: 1.5 });
        const host = reader.host();
        const anchor = { x: host.left + 300, y: host.top + 200 };
        const before = reader.box();
        const fx = (anchor.x - before.left) / before.width;
        const fy = (anchor.y - before.top) / before.height;
        renderer.setZoom({ fit: "width", factor: 3 }, { anchor });
        const after = reader.box();
        near(after.left + fx * after.width, anchor.x, `${flow} anchor x`);
        near(after.top + fy * after.height, anchor.y, `${flow} anchor y`);
      } finally {
        await reader.close();
      }
    }
  });

  await check("a live zoom shows the page at once without laying it out, and rasters once it settles", async () => {
    const reader = await open("scrolled");
    try {
      const { renderer } = reader;
      const doc = reader.page()!;
      const canvas = doc.querySelector("#canvas > canvas");
      const frame = doc.defaultView!.frameElement as HTMLElement;
      const width = renderer.clientWidth;
      const laid = { width: frame.style.width, scrollTop: renderer.scrollTop, scrollHeight: renderer.scrollHeight };
      renderer.setZoom({ fit: "auto", factor: 1.25 }, { live: true });
      renderer.setZoom({ fit: "auto", factor: 1.5 }, { live: true });
      assert(renderer.zoom.factor === 1.5, `A live step left the zoom at ${renderer.zoom.factor}`);
      // Shown at the new size at once, from the raster it already had...
      assert(doc.querySelector("#canvas > canvas") === canvas, "A live step rastered the page");
      near(reader.box().width, width * 1.5, "live-presented page width");
      // ...by transform: the layout a step would otherwise redo stands as it was.
      assert(frame.style.width === laid.width, "A live step resized the page's frame");
      assert(renderer.scrollTop === laid.scrollTop, "A live step scrolled the layout");
      await waitFor("the settled raster", () => doc.querySelector("#canvas > canvas") !== canvas);
      near(pageScale(doc), (width * 1.5) / PAGE.width, "settled raster scale", 0.01);
      near(parseFloat(frame.style.width), width * 1.5, "settled frame width");
      near(reader.box().width, width * 1.5, "settled page width");
    } finally {
      await reader.close();
    }
  });

  await check("a live zoom shows the page where its layout then puts it", async () => {
    // Each case is a pinch from `from`: live steps about `anchor` (a point of
    // the reading area), then the settling layout. What the preview showed and
    // what the layout shows must be the same box — through the centering of a
    // page smaller than the reading area and the ends of the scroll range too.
    const cases = [
      { flow: "scrolled", fit: "width", from: 1, steps: [1.3, 1.9, 2.6], anchor: { x: 250, y: 180 } },
      { flow: "scrolled", fit: "width", from: 2.4, steps: [1.8, 1.1, 0.7], anchor: { x: 620, y: 400 } },
      { flow: "scrolled", fit: "width", from: 0.6, steps: [0.8, 1.2, 1.7], anchor: { x: 700, y: 100 } },
      { flow: "paginated", fit: "page", from: 1, steps: [1.4, 2.2, 3.1], anchor: { x: 500, y: 150 } },
      { flow: "paginated", fit: "page", from: 3, steps: [2.2, 1.3, 0.8], anchor: { x: 200, y: 450 } },
      { flow: "paginated", fit: "page", from: 0.7, steps: [1.1, 1.6], anchor: { x: 450, y: 300 } },
      // Wider than the reading area but no taller: scrolled one way, centered the other.
      { flow: "paginated", fit: "page", from: 1, steps: [1.2, 1.45], anchor: { x: 450, y: 300 }, landscape: true },
      // A two-page spread: each frame is carried to its own place in the row.
      { flow: "paginated", fit: "page", from: 1, steps: [1.3, 2.1], anchor: { x: 600, y: 250 }, columns: 2 },
      { flow: "paginated", fit: "page", from: 2.5, steps: [1.6, 0.8], anchor: { x: 300, y: 350 }, columns: 2 },
    ] as const;
    for (const [number, { flow, fit, from, steps, anchor, ...rest }] of cases.entries()) {
      const label = `case ${number + 1} (${flow} ${from}→${steps.at(-1)})`;
      const reader = await open(flow, 1, {
        source: "landscape" in rest ? landscapeFile : file,
        columns: "columns" in rest ? rest.columns : 1,
      });
      try {
        const { renderer } = reader;
        renderer.setZoom({ fit, factor: from });
        // Somewhere inside the page, so the anchor has room to hold.
        renderer.scrollLeft = renderer.scrollWidth / 5;
        renderer.scrollTop += renderer.clientHeight / 4;
        const host = reader.host();
        const point = { x: host.left + anchor.x, y: host.top + anchor.y };
        const start = reader.box();
        for (const factor of steps) {
          const before = reader.box();
          const held = { x: (point.x - before.left) / before.width, y: (point.y - before.top) / before.height };
          renderer.setZoom({ fit, factor }, { anchor: point, live: true });
          const shown = reader.box();
          // The point under the fingers stays there wherever the scroll range
          // lets it (a stack's range runs past this one page, either way).
          const wanted = { x: held.x * shown.width - anchor.x, y: held.y * shown.height - anchor.y };
          if (wanted.x > 1 && wanted.x < shown.width - renderer.clientWidth - 1)
            near(shown.left + held.x * shown.width, point.x, `${label} at ${factor}: previewed anchor x`);
          if (flow === "scrolled" || (wanted.y > 1 && wanted.y < shown.height - renderer.clientHeight - 1))
            near(shown.top + held.y * shown.height, point.y, `${label} at ${factor}: previewed anchor y`);
        }
        const shown = reader.box();
        near(shown.width, (start.width * steps.at(-1)!) / from, `${label}: previewed width`);
        // The spread's other page, if one is shown beside this one.
        const beside = renderer.getContents().flatMap(({ index }) => {
          const frame = index == null || index === 1 ? null : reader.page(index)?.defaultView?.frameElement;
          // Cached spreads stay in the DOM, hidden; only the one on screen counts.
          return frame && getComputedStyle(frame).visibility !== "hidden"
            ? [[index!, reader.box(index!)] as const]
            : [];
        });
        if ("columns" in rest) assert(beside.length > 0, `${label}: the spread shows one page only`);
        // Settle it: the layout takes over from the preview without moving the page.
        renderer.setZoom({ fit, factor: steps.at(-1)! }, { anchor: point });
        const settled = reader.box();
        for (const [index, box] of beside) {
          const landed = reader.box(index);
          near(landed.left, box.left, `${label}: page ${index} settled left`);
          near(landed.top, box.top, `${label}: page ${index} settled top`);
          near(landed.width, box.width, `${label}: page ${index} settled width`);
        }
        near(settled.left, shown.left, `${label}: settled left`);
        near(settled.top, shown.top, `${label}: settled top`);
        near(settled.width, shown.width, `${label}: settled width`);
        near(settled.height, shown.height, `${label}: settled height`);
        const frame = reader.page()!.defaultView!.frameElement as HTMLElement;
        near(parseFloat(frame.style.width), settled.width, `${label}: laid-out frame width`);
      } finally {
        await reader.close();
      }
    }
  });

  await check("a previewed zoom is laid out before anything moves or measures the layout", async () => {
    // Turning the page mid-pinch: the turn starts from the zoom on screen.
    const paged = await open("paginated", 1);
    try {
      const { renderer } = paged;
      renderer.setZoom({ fit: "page", factor: 2 }, { live: true });
      await renderer.next();
      await waitFor("next page", () => renderer.index === 2);
      near(paged.box(2).height, renderer.clientHeight * 2, "page turned to at the zoom");
      assert(renderer.panEdges.top && renderer.panEdges.left, "The page turned to did not open at its start");
      // And panning or restoring a place acts on the laid-out page.
      renderer.setZoom({ fit: "page", factor: 3 }, { live: true });
      const previewed = paged.box(2);
      assert(renderer.panBy(0, 100), "A previewed page did not pan");
      near(paged.box(2).top, previewed.top - 100, "panned from where the preview showed the page");
      near(paged.box(2).height, renderer.clientHeight * 3, "page height once laid out");
      const frame = paged.page(2)!.defaultView!.frameElement as HTMLElement;
      near(parseFloat(frame.style.height), renderer.clientHeight * 3, "laid-out frame height");
    } finally {
      await paged.close();
    }
    // Reading where the reader is looking does not need the layout: the focus
    // names the same point of the same page before, during and after.
    const scrolled = await open("scrolled", 1);
    try {
      const { renderer } = scrolled;
      renderer.setZoom({ fit: "width", factor: 1.5 });
      const before = renderer.viewFocus!;
      renderer.setZoom({ fit: "width", factor: 2.4 }, { live: true });
      const during = renderer.viewFocus!;
      assert(during.index === before.index, `Mid-zoom the focus named page ${during.index}`);
      near(during.x, before.x, "previewed focus x", 0.005);
      near(during.y, before.y, "previewed focus y", 0.005);
      renderer.setZoom({ fit: "width", factor: 2.4 });
      const after = renderer.viewFocus!;
      near(after.x, before.x, "settled focus x", 0.005);
      near(after.y, before.y, "settled focus y", 0.005);
      // A jump mid-pinch lands on its page at the zoom on screen.
      renderer.setZoom({ fit: "width", factor: 1.2 }, { live: true });
      await renderer.goTo({ index: 2 });
      await waitFor("the page jumped to", () => renderer.index === 2);
      near(scrolled.box(2).width, renderer.clientWidth * 1.2, "page jumped to at the zoom");
      near(scrolled.box(2).top, scrolled.host().top, "page jumped to at the top of the reading area");
    } finally {
      await scrolled.close();
    }
  });

  await check("a zoom past the raster budget sharpens the visible part, and releases it zoomed out", async () => {
    const reader = await open("scrolled");
    try {
      const { renderer } = reader;
      const doc = reader.page()!;
      renderer.setZoom({ fit: "auto", factor: 4 });
      const detail = () => doc.querySelector<HTMLCanvasElement>("canvas[data-detail]");
      await waitFor("the sharp overlay", () => !!detail());
      const scale = (renderer.clientWidth * 4 * devicePixelRatio) / PAGE.width;
      const base = doc.querySelector<HTMLCanvasElement>("#canvas > canvas:not([data-detail])")!;
      assert(base.width < PAGE.width * scale - 1, "The page raster was not capped at this zoom");
      // The overlay is drawn at the full scale and covers the viewport. Its
      // rect is in the page document's coordinates; the frame places those.
      const inPage = detail()!.getBoundingClientRect();
      const frame = reader.box();
      const overlay = new DOMRect(frame.left + inPage.left, frame.top + inPage.top, inPage.width, inPage.height);
      near(detail()!.width / overlay.width, devicePixelRatio, "overlay device pixels per CSS px", 0.02);
      const host = reader.host();
      assert(
        overlay.left <= host.left + 1 &&
          overlay.top <= host.top + 1 &&
          overlay.right >= host.left + renderer.clientWidth - 1 &&
          overlay.bottom >= host.top + renderer.clientHeight - 1,
        "The overlay does not cover the viewport",
      );
      // Bring the fixture's black square (page units 30–230 × 200–400 from
      // the top) to the middle; the redrawn overlay must show it there, and
      // white paper beside it.
      const display = (renderer.clientWidth * 4) / PAGE.width;
      const previous = detail();
      renderer.scrollLeft += reader.box().left + 130 * display - (host.left + renderer.clientWidth / 2);
      renderer.scrollTop += reader.box().top + 300 * display - (host.top + renderer.clientHeight / 2);
      await waitFor("the overlay to follow the viewport", () => !!detail() && detail() !== previous);
      const sample = (x: number, y: number) => {
        const canvas = detail()!;
        const rect = canvas.getBoundingClientRect();
        const ratio = canvas.width / rect.width;
        const [r] = canvas
          .getContext("2d")!
          .getImageData(
            Math.round((x * display - rect.left) * ratio),
            Math.round((y * display - rect.top) * ratio),
            1,
            1,
          ).data;
        return r;
      };
      assert(sample(130, 300) < 40, `The overlay missed the square (${sample(130, 300)})`);
      assert(sample(245, 300) > 215, `The overlay shows ink beside the square (${sample(245, 300)})`);
      renderer.setZoom({ fit: "auto", factor: 1 });
      await waitFor("the overlay released", () => !detail());
    } finally {
      await reader.close();
    }
  });

  await check("a page that arrives mid-pinch rasters without waiting for the pinch to end", async () => {
    const book = await modules.pdf.makePDF(file);
    const view = new modules.view.View();
    view.style.cssText = `display:block;position:fixed;left:0;top:0;width:${WIDTH}px;height:${HEIGHT}px;opacity:0;pointer-events:none;z-index:-1`;
    document.body.append(view);
    let pinching = true;
    try {
      await view.open(book);
      const renderer = view.renderer as FixedLayout;
      renderer.setLayout("scrolled", 1);
      // A pinch in progress: live steps every 50 ms, never settling.
      let factor = 1;
      const pinch = async () => {
        while (pinching) {
          factor = factor >= 1.5 ? 1.2 : factor + 0.02;
          renderer.setZoom({ fit: "auto", factor }, { live: true });
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      };
      const steps = pinch();
      await view.goTo(1);
      const page = () => renderer.getContents().find((content) => content.index === 1)?.doc;
      await waitFor("a first raster during the pinch", () => !!page()?.querySelector("#canvas > canvas"), 5000);
      pinching = false;
      await steps;
    } finally {
      pinching = false;
      await view.close();
      view.remove();
      await book.destroy();
    }
  });

  await check(
    "a page a pinch brings into view rasters for the zoom on its way, shown at the zoom laid out",
    async () => {
      const book = await modules.pdf.makePDF(file);
      const view = new modules.view.View();
      view.style.cssText = `display:block;position:fixed;left:0;top:0;width:${WIDTH}px;height:${HEIGHT}px;opacity:0;pointer-events:none;z-index:-1`;
      document.body.append(view);
      let pinching = true;
      try {
        await view.open(book);
        const renderer = view.renderer as FixedLayout;
        renderer.setLayout("scrolled", 1);
        renderer.setZoom({ fit: "auto", factor: 3 });
        // The page gone to is live when this returns; its neighbours follow.
        await view.goTo(1);
        const width = renderer.clientWidth;
        // Pinched far out before they arrive, and held there without settling.
        let factor = 0.6;
        const pinch = async () => {
          while (pinching) {
            factor = factor === 0.6 ? 0.62 : 0.6;
            renderer.setZoom({ fit: "auto", factor }, { live: true });
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        };
        const steps = pinch();
        const neighbour = () => renderer.getContents().find((content) => content.index === 2)?.doc;
        const raster = () => neighbour()?.querySelector<HTMLCanvasElement>("#canvas > canvas");
        await waitFor("a neighbour's first raster during the pinch", () => !!raster(), 5000);
        const frame = neighbour()!.defaultView!.frameElement as HTMLElement;
        // Still laid out at the zoom the pinch began from...
        near(parseFloat(frame.style.width), width * 3, "laid-out frame width mid-pinch");
        // ...drawn for the zoom on its way, not that one: a fifth of the pixels across...
        const drawn = raster()!.width / devicePixelRatio / width;
        assert(drawn > 0.55 && drawn < 0.67, `The neighbour rastered at ${drawn.toFixed(2)}× the fit, not the pinch's`);
        // ...and stretched over its frame, which the preview shows at the pinch's size.
        near(raster()!.getBoundingClientRect().width, width * 3, "raster presented across the laid-out frame", 3);
        near(frame.getBoundingClientRect().width, width * factor, "neighbour on screen at the pinch's zoom", 3);
        pinching = false;
        await steps;
      } finally {
        pinching = false;
        await view.close();
        view.remove();
        await book.destroy();
      }
    },
  );

  await check("a settled zoom keeps the sharp overlay until its replacement is drawn", async () => {
    const reader = await open("scrolled");
    try {
      const { renderer } = reader;
      const doc = reader.page()!;
      renderer.setZoom({ fit: "auto", factor: 4 });
      const detail = () => doc.querySelector<HTMLCanvasElement>("canvas[data-detail]");
      await waitFor("the sharp overlay", () => !!detail());
      const base = doc.querySelector("#canvas > canvas:not([data-detail])");
      let lost = false;
      const observer = new MutationObserver(() => {
        if (!detail()) lost = true;
      });
      observer.observe(doc.querySelector("#canvas")!, { childList: true });
      renderer.setZoom({ fit: "auto", factor: 4.5 });
      await waitFor("the page re-rastered", () => doc.querySelector("#canvas > canvas:not([data-detail])") !== base);
      await waitFor("the overlay redrawn for the new zoom", () => {
        const canvas = detail();
        return !!canvas && Math.abs(canvas.width / canvas.getBoundingClientRect().width - devicePixelRatio) < 0.02;
      });
      observer.disconnect();
      assert(!lost, "The page showed without its sharp overlay between rasters");
    } finally {
      await reader.close();
    }
  });

  await check("a zoom never names a page the reader is not on", async () => {
    const reader = await open("scrolled");
    try {
      const { renderer } = reader;
      const reported: number[] = [];
      renderer.addEventListener("relocate", (event) =>
        reported.push((event as CustomEvent<{ index: number }>).detail.index),
      );
      for (const [factor, live] of [
        [2.5, true],
        [3, true],
        [3, false],
        [1.2, false],
      ] as const) {
        renderer.setZoom({ fit: "auto", factor }, { live });
        // Decided from the restored scroll position, not the one before it.
        if (renderer.index !== 1) throw new Error(`At ${factor}×, the current page read as ${renderer.index}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
      assert(
        reported.every((index) => index === 1),
        `Reported pages ${JSON.stringify(reported)} while zooming page 1`,
      );
    } finally {
      await reader.close();
    }
  });

  await check("the place a zoomed page was read at comes back", async () => {
    for (const flow of ["scrolled", "paginated"] as const) {
      const first = await open(flow);
      let saved: NonNullable<FixedLayout["viewFocus"]>;
      try {
        first.renderer.setZoom({ fit: "width", factor: 2.5 });
        first.renderer.scrollLeft += 200;
        first.renderer.scrollTop += flow === "scrolled" ? 300 : 150;
        const focus = first.renderer.viewFocus;
        if (!focus) throw new Error(`${flow}: no focus`);
        saved = focus;
      } finally {
        await first.close();
      }
      assert(saved.index === 1, `${flow}: focus names page ${saved.index}`);
      const second = await open(flow);
      try {
        second.renderer.setZoom({ fit: "width", factor: 2.5 });
        assert(second.renderer.showFocus(saved), `${flow}: focus was not shown`);
        const shown = second.renderer.viewFocus!;
        near(shown.x, saved.x, `${flow} focus x`, 0.005);
        near(shown.y, saved.y, `${flow} focus y`, 0.005);
        assert(!second.renderer.showFocus({ ...saved, index: 0 }), `${flow}: another page's focus was shown`);
      } finally {
        await second.close();
      }
    }
  });

  const overflowOf = (renderer: FixedLayout) => {
    const { overflowX, overflowY } = getComputedStyle(renderer);
    return `${overflowX} ${overflowY}`;
  };

  await check(
    "a locked portrait page holds its column: it pans down the page only, and turns keep the column",
    async () => {
      const reader = await open("paginated", 1);
      try {
        const { renderer } = reader;
        renderer.setZoom({ fit: "page", factor: 3 });
        renderer.scrollLeft = 150;
        renderer.scrollTop = 200;
        renderer.setViewLocked(true);
        assert(renderer.lockedAxis === "x", `A portrait page locked ${renderer.lockedAxis}`);
        assert(
          overflowOf(renderer) === "hidden auto",
          `Locked portrait page scrolls natively as ${overflowOf(renderer)}`,
        );
        // Sideways nothing moves it; down the page it pans as it does unlocked.
        assert(!renderer.panBy(40, 0), "A locked view panned sideways");
        assert(renderer.panBy(40, 40), "A locked view did not pan down its page");
        near(renderer.scrollLeft, 150, "locked column after a diagonal pan");
        near(renderer.scrollTop, 240, "distance panned down the page");
        let edges = renderer.panEdges;
        assert(edges.left && edges.right, "A locked column reports room to pan sideways");
        assert(!edges.top && !edges.bottom, "A page with more above and below reads as at its edges");
        // To the bottom, where a pan moves nothing — so the reader turns the page.
        assert(renderer.panBy(0, renderer.scrollHeight), "The page's end was out of reach");
        assert(renderer.panEdges.bottom, "The view did not reach the page's end");
        assert(!renderer.panBy(0, 40), "A pan moved a view already at the page's end");
        await renderer.next();
        await waitFor("next page", () => renderer.index === 2);
        // The next page opens at its top, on the same column.
        near(renderer.scrollTop, 0, "reading start of the page turned to");
        near(renderer.scrollLeft, 150, "locked column after a turn");
        assert(
          overflowOf(renderer) === "hidden auto",
          `After a turn the page scrolls natively as ${overflowOf(renderer)}`,
        );
        // Turning back opens the page at its end, still on that column.
        await renderer.prev();
        await waitFor("previous page", () => renderer.index === 1);
        edges = renderer.panEdges;
        assert(edges.bottom && !edges.top, "Turning back did not open the page at its end");
        near(renderer.scrollLeft, 150, "locked column turning back");
        // A zoom still moves it, and it stays locked there.
        renderer.setZoom({ fit: "page", factor: 3.5 });
        assert(renderer.viewLocked && renderer.lockedAxis === "x", "A zoom released the lock");
        assert(Math.abs(renderer.scrollLeft - 150) > 1, "A zoom could not move a locked view");
        renderer.setViewLocked(false);
        assert(renderer.lockedAxis === null, "An unlocked view still holds an axis");
        assert(overflowOf(renderer) === "auto auto", `Unlocked, the page scrolls natively as ${overflowOf(renderer)}`);
        assert(renderer.panBy(-30, 0), "An unlocked view did not pan sideways");
      } finally {
        await reader.close();
      }
    },
  );

  await check("a locked landscape page holds its band: it pans across the page only", async () => {
    const reader = await open("paginated", 1, { source: landscapeFile });
    try {
      const { renderer } = reader;
      renderer.setZoom({ fit: "page", factor: 3 });
      renderer.scrollLeft = 150;
      renderer.scrollTop = 200;
      renderer.setViewLocked(true);
      assert(renderer.lockedAxis === "y", `A landscape page locked ${renderer.lockedAxis}`);
      assert(
        overflowOf(renderer) === "auto hidden",
        `Locked landscape page scrolls natively as ${overflowOf(renderer)}`,
      );
      assert(!renderer.panBy(0, 40), "A locked view panned up and down a landscape page");
      assert(renderer.panBy(40, 40), "A locked view did not pan across its page");
      near(renderer.scrollTop, 200, "locked band after a diagonal pan");
      near(renderer.scrollLeft, 190, "distance panned across the page");
      const edges = renderer.panEdges;
      assert(edges.top && edges.bottom, "A locked band reports room to pan up and down");
      assert(!edges.left && !edges.right, "A page with more to either side reads as at its edges");
      await renderer.next();
      await waitFor("next page", () => renderer.index === 2);
      near(renderer.scrollLeft, 0, "reading start of the page turned to");
      near(renderer.scrollTop, 200, "locked band after a turn");
      await renderer.prev();
      await waitFor("previous page", () => renderer.index === 1);
      assert(renderer.panEdges.right && !renderer.panEdges.left, "Turning back did not open the page at its end");
      near(renderer.scrollTop, 200, "locked band turning back");
    } finally {
      await reader.close();
    }
  });

  await check("a view locked before its first page shows takes its axis from that page", async () => {
    for (const [source, axis, overflow] of [
      [file, "x", "hidden auto"],
      [landscapeFile, "y", "auto hidden"],
    ] as const) {
      const reader = await open("paginated", 1, {
        source,
        prepare: (renderer) => {
          renderer.setZoom({ fit: "page", factor: 3 });
          renderer.setViewLocked(true);
          assert(renderer.viewLocked, "The lock was not taken before a page showed");
        },
      });
      try {
        const { renderer } = reader;
        assert(renderer.lockedAxis === axis, `Opened locked ${renderer.lockedAxis}, expected ${axis}`);
        assert(overflowOf(renderer) === overflow, `Opened scrolling natively as ${overflowOf(renderer)}`);
      } finally {
        await reader.close();
      }
    }
  });

  await check("a locked continuous scroll holds sideways and scrolls on, whatever shape its pages are", async () => {
    for (const source of [file, landscapeFile]) {
      // Locked before its first page shows, as a remembered lock is.
      const reader = await open("scrolled", 1, { source, prepare: (renderer) => renderer.setViewLocked(true) });
      try {
        const { renderer } = reader;
        renderer.setZoom({ fit: "width", factor: 2 });
        assert(renderer.lockedAxis === "x", `A continuous scroll locked ${renderer.lockedAxis}`);
        assert(overflowOf(renderer) === "hidden auto", `Locked, it scrolls natively as ${overflowOf(renderer)}`);
        // A zoom still moves it sideways, and the stack scrolls as ever.
        assert(renderer.scrollLeft > 0, "The zoom did not keep the view on its anchor");
        const top = renderer.scrollTop;
        renderer.scrollTop = top + 300;
        near(renderer.scrollTop, top + 300, "scrolled distance");
        // A wheel over a page scrolls the stack through the page's own
        // listener: down it as ever, sideways not at all.
        const wheel = (deltaX: number, deltaY: number) => {
          const doc = reader.page()!;
          const WheelEventOfPage = (doc.defaultView as Window & typeof globalThis).WheelEvent;
          doc.body.dispatchEvent(new WheelEventOfPage("wheel", { deltaX, deltaY, bubbles: true, cancelable: true }));
        };
        const held = { left: renderer.scrollLeft, top: renderer.scrollTop };
        wheel(80, 0);
        near(renderer.scrollLeft, held.left, "locked: sideways wheel over a page");
        wheel(-60, 120);
        near(renderer.scrollLeft, held.left, "locked: sideways part of a diagonal wheel");
        near(renderer.scrollTop, held.top + 120, "locked: downward part of a diagonal wheel");
        renderer.setViewLocked(false);
        assert(renderer.lockedAxis === null, "An unlocked scroll still holds an axis");
        assert(overflowOf(renderer) === "auto auto", `Unlocked, it scrolls natively as ${overflowOf(renderer)}`);
        wheel(-80, 0);
        near(renderer.scrollLeft, held.left - 80, "unlocked: sideways wheel over a page");
      } finally {
        await reader.close();
      }
    }
  });

  await check("a lock follows the flow: sideways in a scroll, across the page once paged", async () => {
    // A landscape page holds the other axis than a scroll does, so a stale
    // one would either stop the scroll or leave it free sideways.
    const reader = await open("paginated", 1, { source: landscapeFile });
    try {
      const { renderer } = reader;
      renderer.setZoom({ fit: "page", factor: 3 });
      renderer.setViewLocked(true);
      assert(renderer.lockedAxis === "y", `A landscape page locked ${renderer.lockedAxis}`);
      renderer.setLayout("scrolled", 1);
      assert(renderer.lockedAxis === "x", `Switched to a continuous scroll, it locked ${renderer.lockedAxis}`);
      assert(overflowOf(renderer) === "hidden auto", `Switched, it scrolls natively as ${overflowOf(renderer)}`);
      await waitFor("the scroll's page", () => renderer.index === 1 && !!reader.page());
      renderer.setLayout("paginated", 1);
      await waitFor("the paged spread", () => renderer.lockedAxis === "y");
      assert(overflowOf(renderer) === "auto hidden", `Paged again, it scrolls natively as ${overflowOf(renderer)}`);
    } finally {
      await reader.close();
    }
  });

  await check("a zoomed paged spread pans, and page turns open it at their reading edge", async () => {
    const reader = await open("paginated", 1);
    try {
      const { renderer } = reader;
      renderer.setZoom({ fit: "page", factor: 1 });
      assert(!renderer.panBy(0, 50), "A fitting page panned");
      const edges = renderer.panEdges;
      assert(edges.top && edges.bottom && edges.left && edges.right, "A fitting page is not at every edge");
      renderer.setZoom({ fit: "page", factor: 3 });
      renderer.scrollTop = 0;
      renderer.scrollLeft = 0;
      near(reader.box().left, reader.host().left, "zoomed page left edge");
      near(reader.box().top, reader.host().top, "zoomed page top edge");
      assert(renderer.panBy(0, 120), "A zoomed page did not pan");
      near(renderer.scrollTop, 120, "panned distance");
      await renderer.next();
      await waitFor("next page", () => renderer.index === 2);
      assert(renderer.panEdges.top && renderer.panEdges.left, "The next page did not open at its start");
      await renderer.prev();
      await waitFor("previous page", () => renderer.index === 1);
      assert(renderer.panEdges.bottom && renderer.panEdges.right, "Turning back did not open the page at its end");
    } finally {
      await reader.close();
    }
  });

  return results;
}
