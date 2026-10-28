import type { Book } from "../../foliate-js/src/book";
import type { Paginator } from "../../foliate-js/src/paginator";
import type { LoadDetail, RelocateDetail } from "../../foliate-js/src/renderer";
import { focusWithReadingSource, readingNativeInput } from "../../src/features/reader/lib/reading-document-input";
import { readingRenderActor } from "../../src/features/reader/lib/reading-render-context";
import { actorCause, causalActor } from "../../src/platform/domain-actor";

type Result = { name: string; passed: boolean; details?: string };

export async function runPaginatorRegressions(PaginatorClass: typeof Paginator): Promise<Result[]> {
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
  const mount = () => {
    const renderer = new PaginatorClass();
    renderer.style.cssText =
      "display:block;position:fixed;left:0;top:0;width:900px;height:600px;opacity:0;pointer-events:none;z-index:-1";
    document.body.append(renderer);
    return renderer;
  };
  const page = (text: string, style = "") =>
    URL.createObjectURL(
      new Blob([`<!doctype html><html><head><style>${style}</style></head><body><p>${text}</p></body></html>`], {
        type: "text/html",
      }),
    );
  const dispose = (renderer: Paginator, urls: string[]) => {
    renderer.destroy();
    renderer.remove();
    urls.forEach((url) => URL.revokeObjectURL(url));
  };

  for (const flow of ["paginated", "scrolled"])
    await check(`${flow} navigation and expansion retain context while a native step starts a new one`, async () => {
      const urls = [page("First ".repeat(200)), page("Second ".repeat(200))],
        renderer = mount();
      const initial = {},
        target = {},
        events: RelocateDetail[] = [],
        loads: LoadDetail[] = [];
      renderer.addEventListener("relocate", (event) => events.push((event as CustomEvent<RelocateDetail>).detail));
      renderer.addEventListener("load", (event) => loads.push((event as CustomEvent<LoadDetail>).detail));
      try {
        renderer.setAttribute("flow", flow);
        renderer.open({ sections: urls.map((url, id) => ({ id, size: 1000, load: () => url })) });
        await renderer.goTo({ index: 0, context: initial });
        equal(events.at(-1)?.context, initial);
        equal(loads.at(-1)?.context, initial);
        await renderer.goTo({ index: 1, context: target });
        equal(events.at(-1)?.context, target);
        equal(loads.at(-1)?.context, target);
        renderer.render();
        equal(events.at(-1)?.context, target);
        const settings = {},
          dimensions = {};
        renderer.setStyles("body { font-size: 23px !important; line-height: 1.8 !important; }", settings);
        await renderer.getContents()[0]?.doc.fonts.ready;
        // CSS expansion keeps its operation while source-document font work settles.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        equal(events.at(-1)?.context, settings);
        renderer.setLayoutAttributes({ "max-inline-size": "470px", gap: "8%" }, dimensions);
        equal(events.at(-1)?.context, dimensions);
        await renderer.prev();
        equal(!!events.at(-1)?.context, true);
        equal(events.at(-1)?.context === dimensions, false);
      } finally {
        dispose(renderer, urls);
      }
    });

  await check(
    "native document focus retains its source and a later navigation retires the queued focus scroll",
    async () => {
      const urls = [page("Focusable content ".repeat(1500))],
        renderer = mount();
      const events: RelocateDetail[] = [];
      const frame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      renderer.addEventListener("relocate", (event) => events.push((event as CustomEvent<RelocateDetail>).detail));
      try {
        renderer.open({ sections: [{ id: 0, size: 20000, load: () => urls[0] }] });
        renderer.inputBridge = readingNativeInput;
        await renderer.goTo({ index: 0, context: {} });
        const doc = renderer.getContents()[0]!.doc;
        const first = doc.createElement("button"),
          second = doc.createElement("button");
        first.textContent = "First focus";
        second.textContent = "Superseded focus";
        doc.body.append(first, second);
        await frame();
        const origin = causalActor("plugin:focus-regression");
        const cause = (event?: RelocateDetail) =>
          event?.context ? actorCause(readingRenderActor(event.context)) : undefined;
        const start = events.length;
        focusWithReadingSource(first, origin);
        equal(doc.activeElement, first);
        await frame();
        equal(
          events.slice(start).some((event) => cause(event) === actorCause(origin)),
          true,
        );
        equal(cause(events.at(-1)), actorCause(origin));
        const old = causalActor("plugin:retired-focus"),
          current = {};
        const next = events.length;
        focusWithReadingSource(second, old);
        await renderer.goTo({ index: 0, anchor: 0, context: current });
        await frame();
        equal(
          events.slice(next).some((event) => cause(event) === actorCause(old)),
          false,
        );
        equal(events.at(-1)?.context, current);
      } finally {
        dispose(renderer, urls);
      }
    },
  );

  await check("a touch settles only a drag, so a turn made by a tap keeps its page", async () => {
    const urls = [page("Tap to turn ".repeat(1500))],
      renderer = mount();
    const frame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const touch = (type: string, screenX: number) => {
      const point = new Touch({
        identifier: 1,
        target: renderer,
        screenX,
        screenY: 300,
        clientX: screenX,
        clientY: 300,
      });
      const ended = type === "touchend";
      renderer.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches: ended ? [] : [point],
          changedTouches: [point],
        }),
      );
    };
    try {
      renderer.setAttribute("flow", "paginated");
      renderer.open({ sections: [{ id: 0, size: 20000, load: () => urls[0] }] });
      await renderer.goTo({ index: 0, context: {} });
      await renderer.next();
      const before = renderer.page;
      // A tap: no movement, and the click it produces turns the page between
      // the lift and the frame where a drag would settle.
      touch("touchstart", 500);
      touch("touchend", 500);
      await renderer.next();
      await frame();
      await frame();
      equal(renderer.page, before + 1);
      // A short, slow-enough drag still settles back onto the page it left.
      const resting = renderer.start;
      touch("touchstart", 500);
      touch("touchmove", 490);
      touch("touchend", 490);
      equal(renderer.start === resting, false);
      await frame();
      await frame();
      equal(renderer.start, resting);
    } finally {
      dispose(renderer, urls);
    }
  });

  await check("page boundaries skip non-linear sections and remain usable after a failed load", async () => {
    const urls = ["First", "Footnote", "Last"].map((text) => page(text));
    let fail = true;
    const unloaded: number[] = [];
    const book: Book = {
      sections: urls.map((url, index) => ({
        id: index,
        size: 10,
        linear: index === 1 ? "no" : "yes",
        load: async () => {
          if (index === 2 && fail) throw new Error("Expected fixture read failure");
          return url;
        },
        unload: () => {
          unloaded.push(index);
        },
      })),
    };
    const renderer = mount();
    try {
      renderer.open(book);
      await renderer.goTo({ index: 0 });
      await renderer.prev();
      equal(renderer.getContents()[0]?.index, 0);
      let rejected = false;
      try {
        await renderer.next();
      } catch {
        rejected = true;
      }
      equal(rejected, true);
      equal(renderer.getContents()[0]?.index, 0);
      fail = false;
      await renderer.next();
      equal(renderer.getContents()[0]?.index, 2);
      equal(unloaded.includes(0), true);
      await renderer.next();
      equal(renderer.getContents()[0]?.index, 2);
      await renderer.prev();
      equal(renderer.getContents()[0]?.index, 0);
    } finally {
      dispose(renderer, urls);
    }
  });

  await check("a newer navigation wins over a late section load", async () => {
    const urls = ["Slow", "Current"].map((text) => page(text));
    let complete: (url: string) => void = () => {
      throw new Error("Load not started");
    };
    const loading = new Promise<string>((resolve) => {
      complete = resolve;
    });
    const renderer = mount();
    let released = 0;
    const old = {},
      current = {},
      observed: object[] = [];
    renderer.addEventListener("relocate", (event) => {
      const context = (event as CustomEvent<RelocateDetail>).detail.context;
      if (context) observed.push(context);
    });
    try {
      renderer.open({
        sections: [
          {
            id: 0,
            size: 10,
            load: () => loading,
            unload: () => {
              released++;
            },
          },
          { id: 1, size: 10, load: () => urls[1] },
        ],
      });
      const first = renderer.goTo({ index: 0, context: old });
      await Promise.resolve();
      await renderer.goTo({ index: 1, context: current });
      complete(urls[0]);
      await first;
      equal(renderer.getContents()[0]?.index, 1);
      equal(renderer.getContents()[0]?.doc.querySelector("p")?.textContent, "Current");
      equal(released, 1);
      equal(observed.includes(old), false);
      equal(observed.at(-1), current);
    } finally {
      dispose(renderer, urls);
    }
  });

  await check("closing a paginator cancels late work and is safe before first navigation", async () => {
    const empty = mount();
    dispose(empty, []);
    const url = page("Late");
    let complete: (url: string) => void = () => {
      throw new Error("Load not started");
    };
    const loading = new Promise<string>((resolve) => {
      complete = resolve;
    });
    const renderer = mount();
    try {
      renderer.open({ sections: [{ id: 0, size: 10, load: () => loading }] });
      const pending = renderer.goTo({ index: 0 });
      await Promise.resolve();
      renderer.destroy();
      complete(url);
      await pending;
      equal(renderer.getContents().length, 0);
    } finally {
      dispose(renderer, [url]);
    }
  });

  for (const vertical of [false, true])
    await check(
      `${vertical ? "vertical" : "horizontal"} scroll: a chapter near EOF aligns at the viewport start without a blank next step`,
      async () => {
        const styles = `body { margin:0; font:18px/28px serif; ${vertical ? "writing-mode:vertical-rl;" : ""} } p,h2 { margin:0; }`;
        const first = URL.createObjectURL(
          new Blob(
            [
              `<!doctype html><html><head><style>${styles}</style></head><body><p>${"Previous chapter text. ".repeat(600)}</p><h2 id="chapter">New chapter</h2><p>Short opening fragment.</p></body></html>`,
            ],
            { type: "text/html" },
          ),
        );
        const second = page("The chapter continues in the next source file.", styles);
        const renderer = mount();
        const events: RelocateDetail[] = [];
        renderer.addEventListener("relocate", (event) => events.push((event as CustomEvent<RelocateDetail>).detail));
        try {
          renderer.setLayoutAttributes({ flow: "scrolled", margin: "40px" });
          renderer.open({
            sections: [first, second].map((url, index) => ({ id: index, size: 1000, load: () => url })),
          });
          await renderer.goTo({ index: 0 });
          const doc = renderer.getContents()[0]!.doc;
          await doc.fonts.ready;
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const contentSize = renderer.viewSize;
          const chapter = doc.getElementById("chapter")!;
          const target = { index: 0, anchor: (doc: Document) => doc.getElementById("chapter") };
          const verify = () => {
            const rect = chapter.getBoundingClientRect();
            const offset = vertical ? renderer.viewSize - rect.right - 80 : rect.top;
            // The configured outer margin is 40px per side; viewSize includes it.
            if (Math.abs(renderer.start - offset) > 1)
              throw new Error(`Target was clamped: ${renderer.start} vs ${offset}`);
            if (!events.at(-1)?.range?.toString().trim().startsWith("New chapter"))
              throw new Error("Previous chapter remains above the selected chapter");
            equal(renderer.viewSize, contentSize);
          };
          await renderer.goTo(target);
          verify();
          renderer.render();
          renderer.render();
          verify();
          // Fraction/end navigation must not land in the temporary trailing space.
          await renderer.goTo({ index: 0, anchor: 1 });
          if (renderer.end > contentSize + 1) throw new Error("End navigation landed after the content");
          await renderer.goTo(target);
          verify();
          await renderer.next();
          equal(renderer.getContents()[0]?.index, 1);
          await renderer.prev();
          equal(renderer.getContents()[0]?.index, 0);
          const previous = renderer.getContents()[0]!.doc;
          if (!events.at(-1)?.range?.toString().includes("Short opening fragment."))
            throw new Error("Returning to the previous section lost its last text");
          // Switching flow retires the trailing space, keeping paged geometry finite.
          await renderer.goTo(target);
          renderer.setAttribute("flow", "paginated");
          if (!Number.isFinite(renderer.pages) || renderer.pages <= 2 || previous !== renderer.getContents()[0]?.doc)
            throw new Error("Flow switch broke the current section");
          const view = previous.defaultView?.frameElement?.parentElement;
          if (!view || parseFloat(view.style.marginBottom) !== 0 || parseFloat(view.style.marginLeft) !== 0)
            throw new Error("Scroll-only space leaked into pagination");
        } finally {
          dispose(renderer, [first, second]);
        }
      },
    );

  await check("paginated margins count space the host already reserved instead of stacking on it", async () => {
    const urls = [page("Edge to edge ".repeat(800))],
      renderer = mount();
    const bands = () => {
      const host = renderer.getBoundingClientRect();
      const frame = (
        renderer.getContents()[0]?.doc.defaultView?.frameElement as HTMLElement | null
      )?.getBoundingClientRect();
      if (!frame) throw new Error("Missing section frame");
      return `${Math.round(frame.top - host.top)}/${Math.round(host.bottom - frame.bottom)}`;
    };
    try {
      renderer.setAttribute("flow", "paginated");
      renderer.setAttribute("margin", "48px");
      renderer.open({ sections: [{ id: 0, size: 1000, load: () => urls[0] }] });
      await renderer.goTo({ index: 0 });
      equal(bands(), "48/48");
      renderer.style.setProperty("--foliate-reserved-top", "62px");
      renderer.style.setProperty("--foliate-reserved-bottom", "34px");
      renderer.render();
      equal(bands(), "0/14");
    } finally {
      dispose(renderer, urls);
    }
  });

  await check("scrolled images have finite limits and vertical/RTL pages retain readable geometry", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 2000;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Missing fixture canvas");
    context.fillStyle = "red";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const imageSource = canvas.toDataURL();
    const image = page(`<img alt="test" src="${imageSource}">`);
    const vertical = page("纵向排版测试。".repeat(250), "body { writing-mode: vertical-rl; line-height: 2; }");
    const rtl = page("نص عربي للقراءة ".repeat(250), "body {direction:rtl;line-height:2}");
    const renderer = mount();
    try {
      renderer.open({
        sections: [image, vertical, rtl].map((url, index) => ({ id: index, size: 1000, load: () => url })),
      });
      renderer.setAttribute("flow", "scrolled");
      await renderer.goTo({ index: 0 });
      const img = renderer.getContents()[0]?.doc.querySelector("img");
      if (!img) throw new Error("Missing image");
      equal(img.naturalWidth, 1000);
      const maxHeight = parseFloat(img.style.maxHeight);
      if (!Number.isFinite(maxHeight) || maxHeight <= 0) throw new Error(`Invalid image limit: ${img.style.maxHeight}`);
      renderer.setAttribute("flow", "paginated");
      await renderer.goTo({ index: 1 });
      equal(renderer.sideProp, "height");
      equal(renderer.scrollProp, "scrollTop");
      if (!Number.isFinite(renderer.pages) || renderer.pages <= 2) throw new Error("Vertical content did not paginate");
      await renderer.goTo({ index: 2 });
      equal(renderer.getAttribute("dir"), "rtl");
      equal(renderer.scrollProp, "scrollLeft");
      if (!Number.isFinite(renderer.start)) throw new Error("Invalid RTL geometry");
    } finally {
      dispose(renderer, [image, vertical, rtl]);
    }
  });
  for (const flow of ["paginated", "scrolled"]) {
    await check(`${flow} section reveal waits for the fonts its text uses`, async () => {
      const fontUrl = URL.createObjectURL(
        new Blob(
          [await (await fetch("/foliate-js/vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf")).arrayBuffer()],
          {
            type: "font/ttf",
          },
        ),
      );
      const urls = [page("First ".repeat(50)), page("Second ".repeat(50))];
      const renderer = mount();
      try {
        renderer.setAttribute("flow", flow);
        renderer.setStyles(
          `@font-face{font-family:"RA Reveal Test";font-display:swap;src:url("${fontUrl}") format("truetype")}` +
            `body{font-family:"RA Reveal Test", serif !important}`,
        );
        renderer.open({ sections: urls.map((url, id) => ({ id, size: 1000, load: () => url })) });
        await renderer.goTo({ index: 0 });
        await renderer.goTo({ index: 1 });
        // Synchronously after goTo: the shown document's fonts are settled and
        // the iframe is revealed — no leftover visibility override.
        const doc = renderer.getContents().find((content) => content.index === 1)!.doc;
        equal(doc.fonts.status, "loaded");
        const face = [...doc.fonts].find((f) => f.family === "RA Reveal Test");
        equal(face?.status, "loaded");
        const frame = doc.defaultView?.frameElement as HTMLElement | null;
        equal(frame?.style.visibility ?? "", "");
      } finally {
        dispose(renderer, urls);
        URL.revokeObjectURL(fontUrl);
      }
    });
    await check(`${flow} section reveal still resolves when a font fails`, async () => {
      const badUrl = URL.createObjectURL(new Blob(["not a font"], { type: "font/ttf" }));
      URL.revokeObjectURL(badUrl);
      const urls = [page("First ".repeat(50)), page("Second ".repeat(50))];
      const renderer = mount();
      try {
        renderer.setAttribute("flow", flow);
        renderer.setStyles(
          `@font-face{font-family:"RA Reveal Broken";font-display:swap;src:url("${badUrl}") format("truetype")}` +
            `body{font-family:"RA Reveal Broken", serif !important}`,
        );
        renderer.open({ sections: urls.map((url, id) => ({ id, size: 1000, load: () => url })) });
        await renderer.goTo({ index: 0 });
        // A failed face is a fallback, not a load error: goTo still resolves.
        await renderer.goTo({ index: 1 });
        const doc = renderer.getContents().find((content) => content.index === 1)!.doc;
        const frame = doc.defaultView?.frameElement as HTMLElement | null;
        equal(frame?.style.visibility ?? "", "");
      } finally {
        dispose(renderer, urls);
      }
    });
  }
  return results;
}
