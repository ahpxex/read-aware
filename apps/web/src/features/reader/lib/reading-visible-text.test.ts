import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { readingVisibleText } from "./reading-visible-text";
import { attachReadingEngine } from "./reading-engine-adapter";
import { readingRuntime } from "../../../domain/reading-runtime";
import type { FoliateView } from "./foliate-engine";
import { buildPluginContext } from "../../plugins/runtime/plugin-context";

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON() {} });

function fixture() {
  const dom = new JSDOM('<main><iframe></iframe><iframe></iframe></main>');
  const renderer = dom.window.document.querySelector("main")!;
  renderer.getBoundingClientRect = () => rect(0, 0, 300, 200);
  const frames = [...renderer.querySelectorAll("iframe")];
  const contents = frames.map((frame, index) => {
    frame.getBoundingClientRect = () => rect(0, index * 300, 300, 200);
    Object.defineProperties(frame, { clientWidth: { value: 600 }, clientHeight: { value: 400 } });
    const doc = frame.contentDocument!;
    doc.body.innerHTML = '<div class="textLayer" data-readaware-text-state="ready"><span>visible</span><span>offscreen</span></div><div>not page text</div>';
    // JSDOM does not lay out pages; the fixture models scaled text-run rectangles.
    const createRange = doc.createRange.bind(doc);
    doc.createRange = () => {
      const range = createRange();
      range.getClientRects = () => [range.startContainer.textContent === "offscreen" ? rect(0, 500, 80, 20) : rect(0, 20, 80, 20)] as unknown as DOMRectList;
      return range;
    };
    return { doc, index };
  });
  Object.assign(renderer, { getContents: () => contents, scrolled: true });
  const view = Object.assign(new EventTarget(), { renderer, isFixedLayout: true, book: { sections: [{}, {}] },
    lastLocation: { range: null, cfi: "page1", fraction: 0, section: { current: 0 } } });
  return { dom, view: view as unknown as FoliateView, contents, frames,
    layer: contents[0].doc.querySelector<HTMLElement>(".textLayer")! };
}

test("PDF viewport uses only intersecting text runs, excludes cached pages, and accounts for frame scaling", () => {
  const f = fixture();
  try {
    expect(readingVisibleText(f.view)).toEqual({ text: "visible", state: { status: "available", source: "pdf-text-layer", truncated: false } });
    f.frames[0].getBoundingClientRect = () => rect(0, -100, 300, 200);
    expect(readingVisibleText(f.view).state.status).toBe("empty");
    f.frames[0].getBoundingClientRect = () => rect(0, 0, 300, 200);
    f.frames[0].style.visibility = "hidden";
    expect(readingVisibleText(f.view).text).toBe("");
    f.frames[0].style.visibility = "visible";
    f.contents[0].doc.querySelector("span")!.style.visibility = "hidden";
    expect(readingVisibleText(f.view).state.status).toBe("empty");
  } finally { f.dom.window.close(); }
});

test("PDF empty, rendering, unsupported and bounded text are distinct", () => {
  const f = fixture();
  try {
    f.layer.dataset.readawareTextState = "loading";
    expect(readingVisibleText(f.view).state).toMatchObject({ status: "unavailable", reason: "not-ready" });
    f.layer.dataset.readawareTextState = "ready"; f.layer.replaceChildren();
    expect(readingVisibleText(f.view).state).toMatchObject({ status: "empty", source: "pdf-text-layer" });
    f.layer.textContent = `${"x".repeat(11999)}\u{1f600}tail`;
    const result = readingVisibleText(f.view);
    expect(result.text).toBe("x".repeat(11999)); expect(result.state.truncated).toBe(true);
    for (const { doc } of f.contents) doc.querySelector(".textLayer")?.remove();
    expect(readingVisibleText(f.view).state).toMatchObject({ status: "unavailable", reason: "unsupported" });
  } finally { f.dom.window.close(); }
});

test("an unfinished visible spread and a scan limit cannot masquerade as an empty page", () => {
  const f = fixture();
  try {
    f.frames[1].getBoundingClientRect = () => rect(200, 0, 300, 200);
    f.contents[1].doc.querySelector<HTMLElement>(".textLayer")!.dataset.readawareTextState = "loading";
    expect(readingVisibleText(f.view).state).toMatchObject({ status: "unavailable", reason: "not-ready" });
    f.frames[1].style.visibility = "hidden";
    const fragment = f.layer.ownerDocument.createDocumentFragment();
    for (let i = 0; i < 20001; i++) fragment.append(f.layer.ownerDocument.createTextNode(" "));
    f.layer.replaceChildren(fragment);
    expect(readingVisibleText(f.view)).toMatchObject({ text: "", state: { status: "unavailable", reason: "scan-limit" } });
  } finally { f.dom.window.close(); }
});

test("reflowable Range semantics remain intact and do not split UTF-16 pairs", () => {
  const view = { isFixedLayout: false, lastLocation: { range: { toString: () => "actual range" } } } as unknown as FoliateView;
  expect(readingVisibleText(view)).toEqual({ text: "actual range", state: { status: "available", source: "range", truncated: false } });
  view.lastLocation!.range = { toString: () => `${"x".repeat(11999)}\u{1f600}` } as Range;
  expect(readingVisibleText(view).text.length).toBe(11999);
  expect(readingVisibleText(view).state.truncated).toBe(true);
  view.lastLocation!.range = null;
  expect(readingVisibleText(view).state).toMatchObject({ status: "unavailable", reason: "not-ready" });
});

test("actual session adapter publishes PDF text/state to plugin queries and clears them when detached", async () => {
  const f = fixture();
  const id = readingRuntime.begin("visible-book");
  const detach = attachReadingEngine(f.view, id, "visible-book", "v1");
  const plugin = buildPluginContext({ id: "visible-text", name: "Visible text", version: "1", schemaVersion: 1,
    requires: { domains: { reading: "^2.17.0" } }, permissions: ["reading:read"] }, "1", []);
  plugin.lifecycle.promote();
  try {
    expect(readingRuntime.snapshot()).toMatchObject({ visibleText: "visible", visibleTextState: { status: "available", source: "pdf-text-layer" } });
    expect(await plugin.context.domains.reading!.queries.session()).toMatchObject({ visibleText: "visible", visibleTextState: { status: "available", source: "pdf-text-layer" } });
    f.layer.dataset.readawareTextState = "loading"; f.view.dispatchEvent(new Event("relocate"));
    expect(readingRuntime.snapshot()).toMatchObject({ visibleText: "", visibleTextState: { status: "unavailable", reason: "not-ready" } });
    detach();
    f.layer.dataset.readawareTextState = "ready"; f.view.dispatchEvent(new Event("relocate"));
    expect(readingRuntime.snapshot()).toMatchObject({ visibleText: "", visibleTextState: { status: "unavailable" } });
  } finally { plugin.lifecycle.stop(); detach(); readingRuntime.closed(); f.dom.window.close(); }
});
