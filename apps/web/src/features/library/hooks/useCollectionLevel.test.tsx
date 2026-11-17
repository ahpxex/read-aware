import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { StrictMode, act, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { useCollectionLevel } from "./useCollectionLevel";

test("moving between the shelf and a collection animates as a page and keeps each level's scroll", () => {
  const dom = new JSDOM("<div class='ra-scrollarea' id='scroller'><div id='root'></div></div>", {
    url: "http://localhost",
  });
  const values = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const globals = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const scroller = dom.window.document.getElementById("scroller")!;
  const moves: boolean[] = [];
  // What the browser does as the collection's shorter page lands in the
  // DOM: the scroll area clamps to it, before any layout effect runs (a
  // child's layout effect runs before its parent's).
  function ShortPage({ collectionId }: { collectionId: string | null }) {
    useLayoutEffect(() => {
      if (collectionId !== null) scroller.scrollTop = Math.min(scroller.scrollTop, 100);
    }, [collectionId]);
    return null;
  }
  function View({ collectionId }: { collectionId: string | null }) {
    const ref = useRef<HTMLDivElement>(null);
    moves.push(useCollectionLevel(collectionId, ref));
    return (
      <div ref={ref}>
        <ShortPage collectionId={collectionId} />
      </div>
    );
  }
  const root = createRoot(dom.window.document.getElementById("root")!);
  const show = (collectionId: string | null) =>
    act(() =>
      root.render(
        <StrictMode>
          <View collectionId={collectionId} />
        </StrictMode>,
      ),
    );
  try {
    show(null);
    // The first level keeps the view's own entrance.
    expect(moves.at(-1)).toBe(false);
    scroller.scrollTop = 1200;

    show("essays");
    expect(moves.at(-1)).toBe(true);
    // A collection opens at its top...
    expect(scroller.scrollTop).toBe(0);
    scroller.scrollTop = 80;

    show("poetry");
    expect(scroller.scrollTop).toBe(0);

    // ...and the shelf comes back where it was left.
    show(null);
    expect(moves.at(-1)).toBe(true);
    expect(scroller.scrollTop).toBe(1200);

    // A render on the same level moves nothing.
    scroller.scrollTop = 900;
    show(null);
    expect(scroller.scrollTop).toBe(900);
  } finally {
    act(() => root.unmount());
    for (const [key, descriptor] of globals)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
  }
});
