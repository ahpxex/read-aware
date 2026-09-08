import { afterAll, beforeAll, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { buildTextUnitRanges } from "./text-unit-index";

const dom = new JSDOM();
const saved = new Map(["Node", "NodeFilter", "Range"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
beforeAll(() => {
  for (const key of saved.keys()) Object.defineProperty(globalThis, key, { configurable: true, value: Reflect.get(dom.window, key) });
});
afterAll(() => {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  dom.window.close();
});
const documentWith = (html: string) => new dom.window.DOMParser().parseFromString(html, "text/html");
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("bounded concurrent segmentation preserves document order and inline node offsets", async () => {
  const doc = documentWith(Array.from({ length: 19 }, (_, i) => `<p>Block <em>${i}</em>.</p>`).join(""));
  let active = 0, peak = 0;
  const units = await buildTextUnitRanges(doc, "paragraph", async ({ text }) => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, text.includes("0") ? 4 : 1));
    active--;
    return [{ start: 0, end: text.length }];
  });
  expect(peak).toBe(8);
  expect(units.map(range => range.toString())).toEqual(Array.from({ length: 19 }, (_, i) => `Block ${i}.`));
});

test("a rejected block invalidates the section instead of silently omitting its text", async () => {
  const doc = documentWith("<p>First.</p><p>Second.</p>");
  await expect(buildTextUnitRanges(doc, "sentence", async ({ text }) => {
    if (text === "Second.") throw new Error("offline");
    return [{ start: 0, end: text.length }];
  })).rejects.toMatchObject({ code: "reader/segmentation-failed", cause: { message: "offline" } });
});

test("malformed offsets fail; a provider's intentional empty result is valid", async () => {
  const doc = documentWith("<p>Text.</p>");
  await expect(buildTextUnitRanges(doc, "sentence", () => [{ start: 0, end: 999 }])).rejects.toMatchObject({ code: "reader/segmentation-failed" });
  expect(await buildTextUnitRanges(doc, "sentence", () => [])).toEqual([]);
});

test("cancelled work dispatches no further blocks and never builds ranges from late replies", async () => {
  const doc = documentWith(Array.from({ length: 30 }, () => "<p>Text.</p>").join(""));
  const owner = new AbortController();
  const pending: (() => void)[] = [];
  const work = buildTextUnitRanges(doc, "sentence", ({ text }) => new Promise(resolve => pending.push(() => resolve([{ start: 0, end: text.length }]))), owner.signal);
  const caught = work.catch(error => error);
  expect(pending).toHaveLength(8);
  owner.abort(new Error("cancelled"));
  for (const resolve of pending) resolve();
  expect(await caught).toMatchObject({ message: "cancelled" });
  await tick();
  expect(pending).toHaveLength(8);
  let invoked = false;
  await expect(buildTextUnitRanges(doc, "sentence", () => { invoked = true; return []; }, owner.signal)).rejects.toThrow("cancelled");
  expect(invoked).toBe(false);
});

test("first failure prevents a backlog of new Worker requests", async () => {
  const doc = documentWith(Array.from({ length: 40 }, () => "<p>Text.</p>").join(""));
  let calls = 0;
  await expect(buildTextUnitRanges(doc, "sentence", async ({ text }) => {
    if (++calls === 1) throw new Error("failed");
    await tick();
    return [{ start: 0, end: text.length }];
  })).rejects.toMatchObject({ code: "reader/segmentation-failed" });
  await tick();
  expect(calls).toBe(8);
});
