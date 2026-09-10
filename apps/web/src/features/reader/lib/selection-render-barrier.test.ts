import { expect, test } from "bun:test";
import { SelectionRenderBarrier } from "./selection-render-barrier";
import type { ReaderSelectionState } from "./selection-overlay";

const selection = (text: string): ReaderSelectionState => ({ text, appearance: "selection", anchorRect: null, cfiRange: null, chapterHref: null, rects: [] });

test("selection completion waits for the matching React commit and ignores an obsolete render", async () => {
  const barrier = new SelectionRenderBarrier(), a = selection("a"), b = selection("b");
  let completed = false;
  const pending = barrier.wait(b).then(() => { completed = true; });
  barrier.acknowledge(a, b); await Promise.resolve(); expect(completed).toBe(false);
  barrier.acknowledge(b, b); await pending; expect(completed).toBe(true);
  let cleared = false;
  const clearing = barrier.wait(null).then(() => { cleared = true; });
  await Promise.resolve(); expect(cleared).toBe(false);
  barrier.acknowledge(null, null); await clearing; expect(cleared).toBe(true);
});

test("new user selection, replacement command and retirement reject old receipts", async () => {
  for (const action of ["user", "command", "retire"] as const) {
    const barrier = new SelectionRenderBarrier(), a = selection("a"), b = selection("b");
    const old = barrier.wait(a).catch(error => error);
    if (action === "user") barrier.acknowledge(b, b);
    if (action === "command") { const next = barrier.wait(b); barrier.acknowledge(b, b); await next; }
    if (action === "retire") barrier.retire();
    expect(await old).toMatchObject({ code: "reader/superseded" });
    barrier.retire();
  }
});

test("abort and deadline settle without a commit; late commits cannot resolve the rejected receipt", async () => {
  const barrier = new SelectionRenderBarrier(5), state = selection("a"), abort = new AbortController();
  const old = barrier.wait(state, abort.signal).catch(error => error);
  abort.abort(Error("cancelled")); expect(await old).toMatchObject({ message: "cancelled" });
  barrier.acknowledge(state, state);
  await expect(barrier.wait(selection("b"))).rejects.toMatchObject({ code: "reader/timeout" });
  expect(() => barrier.wait(null, abort.signal)).toThrow("cancelled");
  barrier.retire();
});
