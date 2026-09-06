import type * as CFI from "../../foliate-js/src/epubcfi";
import type { View } from "../../foliate-js/src/view";

type Result = { name: string; passed: boolean; details?: string };
type FoundationModules = {
  search: typeof import("../../foliate-js/src/search");
  walker: typeof import("../../foliate-js/src/text-walker");
  tts: typeof import("../../foliate-js/src/tts");
  quote: typeof import("../../foliate-js/src/quote-image");
};

/** Execute inside Tauri, after reloading the frontend's generated engine modules. */
export async function runFoliateRegressions(cfi: typeof CFI, foundation?: FoundationModules): Promise<Result[]> {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("Run this suite inside Tauri");
  const results: Result[] = [];
  const check = async (name: string, run: () => void | Promise<void>) => {
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
  const xhtml = (body: string) => new DOMParser().parseFromString(
    `<html xmlns="http://www.w3.org/1999/xhtml"><head/><body>${body}</body></html>`,
    "application/xhtml+xml",
  );

  await check("CFI restores exact selections", () => {
    const doc = xhtml("<p>Hello world, test selection.</p>");
    const text = doc.querySelector("p")?.firstChild;
    if (!text) throw new Error("Missing fixture text");
    const range = doc.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 11);
    equal(cfi.toRange(doc, cfi.parse(cfi.fromRange(range))).toString(), "world");
  });

  await check("CFI preserves logical offsets across CDATA and comments", () => {
    const doc = xhtml("<p>xxx<em>yyy</em><![CDATA[]]><!--one--><![CDATA[0123]]>4<!--two-->5<![CDATA[67]]>&#56;&#57;</p>");
    for (let index = 0; index < 10; index++) {
      const range = cfi.toRange(doc, cfi.parse(`/4/2,/3:${index},/3:${index + 1}`));
      equal(range.toString(), String(index));
      equal(cfi.toRange(doc, cfi.parse(cfi.fromRange(range))).toString(), String(index));
    }
  });

  if (foundation) {
    await check("search and TTS preserve ranges across native CDATA and inline elements", () => {
      const doc = xhtml('<p lang="en">Hello <![CDATA[wo]]><em>rld</em>. Next sentence.</p>');
      const match = [...foundation.search.searchMatcher(foundation.walker.textWalker,
        { matchWholeWords: true })(doc, "world")];
      equal(match.length, 1);
      equal(match[0].range.toString(), "world");
      let highlighted = "";
      const tts = new foundation.tts.TTS(doc, foundation.walker.textWalker,
        range => { highlighted = range.toString(); });
      const speech = new DOMParser().parseFromString(tts.start() ?? "", "application/xml");
      equal(speech.documentElement.textContent, "Hello world. Next sentence.");
      tts.setMark("1");
      equal(highlighted, "world");
      equal(new DOMParser().parseFromString(tts.resume() ?? "", "application/xml")
        .documentElement.textContent, "world. Next sentence.");
    });

    await check("quote export produces a nonblank PNG in the desktop webview", async () => {
      const quote = new foundation.quote.QuoteImage();
      document.body.append(quote);
      let url: string | undefined;
      try {
        const blob = await quote.getBlob({ title: "A #title", author: "Writer", text: "A quote & its punctuation." });
        equal(blob.type, "image/png");
        url = URL.createObjectURL(blob);
        const img = new Image();
        img.src = url;
        await img.decode();
        equal(img.naturalWidth, 1080);
        equal(img.naturalHeight, 1080);
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Missing canvas context");
        context.drawImage(img, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let light = 0, dark = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] < 128) continue;
          if (pixels[i] > 240) light++;
          if (pixels[i] < 80) dark++;
        }
        if (light < 10000 || dark < 100) throw new Error(`Blank export: light=${light}, dark=${dark}`);
      } finally {
        quote.remove();
        if (url) URL.revokeObjectURL(url);
      }
    });
  }

  await check("default scrolled next/prev move a viewport; explicit distances stay pixels", async () => {
    const view = document.createElement("foliate-view") as View;
    view.style.cssText = "display:block;position:fixed;left:0;top:0;width:640px;height:480px;opacity:0;pointer-events:none;z-index:-1";
    const html = "<!doctype html><html><head><style>p {margin:16px 0;line-height:24px}</style></head><body>"
      + Array.from({ length: 120 }, (_, index) => `<p>Engine regression paragraph ${index}. Continuous scrolling.</p>`).join("")
      + "</body></html>";
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    document.body.append(view);
    try {
      await view.open({
        metadata: { language: "en" },
        sections: [{
          id: "regression", size: html.length, load: () => url, unload: () => {},
          createDocument: () => new DOMParser().parseFromString(html, "text/html"),
        }],
      });
      view.renderer.setAttribute("flow", "scrolled");
      await view.goTo(0);
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      const renderer = view.renderer as import("../../foliate-js/src/paginator").Paginator;
      const start = renderer.start;
      const height = renderer.size;
      if (height <= 0 || renderer.viewSize <= height) throw new Error("Fixture did not lay out");
      await view.next();
      equal(renderer.start - start, height);
      await view.prev();
      equal(renderer.start, start);
      await view.next(200);
      equal(renderer.start - start, 200);
      await view.prev(100);
      equal(renderer.start - start, 100);
    } finally {
      view.close();
      view.remove();
      URL.revokeObjectURL(url);
    }
  });
  return results;
}
