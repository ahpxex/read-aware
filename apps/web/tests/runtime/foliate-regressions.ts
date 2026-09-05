import type * as CFI from "../../foliate-js/src/epubcfi";
import type { View } from "../../foliate-js/src/view";

type Result = { name: string; passed: boolean; details?: string };

/** Execute inside Tauri, after reloading the frontend's generated engine modules. */
export async function runFoliateRegressions(cfi: typeof CFI): Promise<Result[]> {
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
