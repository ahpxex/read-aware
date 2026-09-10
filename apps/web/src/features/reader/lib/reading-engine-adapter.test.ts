import { expect, test } from "bun:test";
import { createReadingEngineAdapter, waitForReadingPaint } from "./reading-engine-adapter";
import type { FoliateView } from "./foliate-engine";

test("fixed-layout completion waits for its actual render promise", async () => {
  let finish!: () => void;
  const rendered = new Promise<void>(resolve => { finish = resolve; });
  const view = { renderer: { waitForCurrentRender: () => rendered } } as unknown as FoliateView;
  let completed = false;
  const pending = waitForReadingPaint(view).then(() => { completed = true; });
  await Promise.resolve(); expect(completed).toBe(false);
  finish(); await pending; expect(completed).toBe(true);
});

test("render failure has a stable error code rather than a success receipt", async () => {
  const cause = new Error("raster failed");
  const view = { renderer: { waitForCurrentRender: async () => { throw cause; } } } as unknown as FoliateView;
  await expect(waitForReadingPaint(view)).rejects.toMatchObject({ code: "reader/render-failed", cause });
});

test("reflowable renderers do not require a fixed-layout paint hook", async () => {
  const view = { renderer: {} } as unknown as FoliateView;
  await expect(waitForReadingPaint(view)).resolves.toBeUndefined();
});

function fixture() {
  const calls: unknown[] = [];
  const value = {
    book: { sections: [{}, { linear: "no" }, {}, {}] },
    lastLocation: { section: { current: 0 }, cfi: "section-0", fraction: 0 },
    renderer: { waitForCurrentRender: async () => {} },
    next: async () => { calls.push("next"); }, prev: async () => { calls.push("previous"); },
    goTo: async (target: unknown) => {
      calls.push(target);
      const index = typeof target === "number" ? target : (target as { fraction: number }).fraction === 0 ? 0 : 3;
      value.lastLocation = { section: { current: index }, cfi: `section-${index}`, fraction: index / 3 };
      return { index };
    },
  };
  return { value, calls, adapter: createReadingEngineAdapter(value as unknown as FoliateView, "book", "v1") };
}

test("source-section steps skip non-linear sections, respect boundaries and reuse renderer positioning", async () => {
  const f = fixture();
  expect((await f.adapter.step("next-section")).cfi).toBe("section-2");
  expect((await f.adapter.step("previous-section")).cfi).toBe("section-0");
  const count = f.calls.length;
  expect((await f.adapter.step("previous-section")).cfi).toBe("section-0"); expect(f.calls).toHaveLength(count);
  expect((await f.adapter.step("end")).cfi).toBe("section-3");
  expect((await f.adapter.step("next-section")).cfi).toBe("section-3");
  expect((await f.adapter.step("start")).cfi).toBe("section-0");
  await f.adapter.step("next"); await f.adapter.step("previous");
  expect(f.calls).toEqual([2, 0, { fraction: 1 }, { fraction: 0 }, "next", "previous"]);
  expect((await f.adapter.navigate({ sectionIndex: 1, contentVersion: "v1" })).cfi).toBe("section-1");
  await expect(f.adapter.navigate({ sectionIndex: 4, contentVersion: "v1" })).rejects.toMatchObject({ code: "reader/target-not-found" });
});

test("section navigation waits for renderer paint and propagates rendering failure", async () => {
  const f = fixture(), paint = Promise.withResolvers<void>();
  f.value.renderer.waitForCurrentRender = () => paint.promise;
  let completed = false;
  const pending = f.adapter.step("next-section").then(value => { completed = true; return value; });
  await Promise.resolve(); expect(completed).toBe(false); paint.resolve(); await pending;
  f.value.renderer.waitForCurrentRender = async () => { throw Error("render failure"); };
  await expect(f.adapter.step("start")).rejects.toMatchObject({ code: "reader/render-failed" });
});
