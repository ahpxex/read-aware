import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { actorCause, causalActor, eventCause, reactionActor, stampEventCause } from "../../../platform/domain-actor";
import {
  acknowledgeReadingSelection,
  focusWithReadingSource,
  readingInputContext,
  readingSelectionFeedback,
  rememberReadingSelection,
} from "./reading-document-input";
import { readingRenderActor, readingRenderContext } from "./reading-render-context";

const actor = () => reactionActor("plugin:input-test", "follow-selection", eventCause(stampEventCause({}))!);
function fixture() {
  const dom = new JSDOM('<div tabindex="-1" id="a">First passage</div><div tabindex="-1" id="b">Second passage</div>');
  const doc = dom.window.document,
    a = doc.getElementById("a")!,
    b = doc.getElementById("b")!;
  const select = (element: HTMLElement, end = 5) => {
    const range = doc.createRange();
    range.setStart(element.firstChild!, 0);
    range.setEnd(element.firstChild!, end);
    doc.getSelection()!.removeAllRanges();
    doc.getSelection()!.addRange(range);
  };
  const change = () => {
    const event = new dom.window.Event("selectionchange");
    doc.dispatchEvent(event);
    return readingSelectionFeedback(doc, event);
  };
  return { dom, doc, a, b, select, change };
}

test("queued selection notifications retain program causes without recapturing an already published selection", async () => {
  const f = fixture(),
    origin = actor();
  try {
    f.select(f.a);
    acknowledgeReadingSelection(f.doc, origin);
    await Bun.sleep(0);
    const feedback = f.change();
    expect(feedback.handled).toBe(true);
    expect(feedback.current()).toBe(true);
    expect(actorCause(feedback.origin)).toBe(actorCause(origin));
    f.doc.dispatchEvent(new f.dom.window.Event("pointerdown"));
    // Independent user intent at identical coordinates must still get a new root.
    const user = f.change();
    expect(user.handled).toBe(false);
    expect(actorCause(user.origin)?.root).not.toBe(actorCause(origin)?.root);
    expect(feedback.current()).toBe(false);
    const pending = f.change();
    f.select(f.b);
    expect(pending.current()).toBe(false);
    const next = f.change();
    acknowledgeReadingSelection(f.doc, causalActor("user"));
    expect(next.current()).toBe(false);
  } finally {
    f.dom.window.close();
  }
});

test("engine selection changes share opaque contexts and delayed samples reject another mutation", () => {
  const f = fixture(),
    origin = actor(),
    context = readingRenderContext(origin);
  try {
    f.select(f.a);
    rememberReadingSelection(f.doc, context);
    const pending = f.change();
    expect(pending.handled).toBe(false);
    expect(actorCause(pending.origin)).toBe(actorCause(origin));
    f.doc.getSelection()!.removeAllRanges();
    rememberReadingSelection(f.doc, readingRenderContext("user"));
    expect(pending.current()).toBe(false);
    expect(actorCause(f.change().origin)?.root).not.toBe(actorCause(origin)?.root);
    expect(JSON.stringify(context)).toBe("{}");
  } finally {
    f.dom.window.close();
  }
});

test("exact focus events and their changed selection keep the caller; nested focus cannot be relabelled by the old call", () => {
  const f = fixture(),
    outer = actor(),
    inner = causalActor("plugin:inner-focus");
  const observed: { id: string; context: object }[] = [];
  f.doc.addEventListener(
    "focusin",
    (event) => {
      observed.push({ id: (event.target as HTMLElement).id, context: readingInputContext(event) });
    },
    true,
  );
  f.a.addEventListener("focus", () => focusWithReadingSource(f.b, inner));
  f.b.addEventListener("focus", () => f.select(f.b));
  // Some engines finish outer's default caret movement after nested focus
  // listeners return. JSDOM collapses the selection before dispatching focus
  // (since 30.1), so that later DOM effect is controlled here.
  const native = f.a.focus.bind(f.a);
  f.a.focus = (options) => {
    native(options);
    f.doc.getSelection()!.collapse(f.a.firstChild, 0);
  };
  try {
    f.select(f.a);
    focusWithReadingSource(f.a, outer);
    expect(f.doc.activeElement).toBe(f.b);
    expect(actorCause(readingRenderActor(observed.find((row) => row.id === "b")!.context))).toBe(actorCause(inner));
    // That distinct final DOM effect must not become an independent user root.
    expect(actorCause(f.change().origin)).toBe(actorCause(outer));
    f.b.blur();
    f.select(f.a);
    f.a.focus = () => {
      focusWithReadingSource(f.b, inner);
    };
    focusWithReadingSource(f.a, outer);
    expect(actorCause(f.change().origin)).toBe(actorCause(inner));
    f.doc.dispatchEvent(new f.dom.window.Event("keydown"));
    expect(actorCause(f.change().origin)?.root).not.toBe(actorCause(inner)?.root);
  } finally {
    f.dom.window.close();
  }
});

test("focus-caused scroll feedback matches the actual offset and is invalidated by independent input", () => {
  const f = fixture(),
    origin = actor();
  const native = f.a.focus.bind(f.a);
  // JSDOM has real focus events but no layout; the scroll side effect is controlled.
  f.a.focus = (options) => {
    native(options);
    f.a.scrollTop = 19;
  };
  const scroll = () => {
    const event = new f.dom.window.Event("scroll", { bubbles: true });
    f.a.dispatchEvent(event);
    return readingRenderActor(readingInputContext(event));
  };
  try {
    focusWithReadingSource(f.a, origin);
    expect(actorCause(scroll())).toBe(actorCause(origin));
    f.a.scrollTop = 20;
    expect(actorCause(scroll())?.root).not.toBe(actorCause(origin)?.root);
    f.a.scrollTop = 19;
    f.a.dispatchEvent(new f.dom.window.Event("wheel", { bubbles: true }));
    expect(actorCause(scroll())?.root).not.toBe(actorCause(origin)?.root);
  } finally {
    f.dom.window.close();
  }
});
