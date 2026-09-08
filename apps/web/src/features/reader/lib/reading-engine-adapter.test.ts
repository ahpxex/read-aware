import { expect, test } from "bun:test";
import type { FoliateView } from "./foliate-engine";
import { waitForReadingPaint } from "./reading-engine-adapter";

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
