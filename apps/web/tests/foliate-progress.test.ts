import { describe, expect, spyOn, test } from "bun:test";
import { SectionProgress, TOCProgress } from "../foliate-js/src/progress";
import { withDom } from "./helpers/foliate-dom";

describe("section progress", () => {
  test("keeps weighted fractions and location counts", () => {
    const progress = new SectionProgress([{ size: 100 }, { size: 100, linear: "no" }, { size: 300 }], 100, 200);
    expect(progress.sectionFractions).toEqual([0, 0.25, 0.25, 1]);
    expect(progress.getProgress(2, 0.5)).toEqual({
      fraction: 0.625, section: { current: 2, total: 3 },
      location: { current: 2, next: 2, total: 4 }, time: { section: 0.75, total: 0.75 },
    });
    const [index, fraction] = progress.getSection(0.625);
    expect(index).toBe(2);
    expect(fraction).toBeCloseTo(0.5);
  });
  test("empty or sizeless content never reports NaN", () => {
    for (const sections of [[], [{ size: 0 }], [{ size: 10, linear: "no" }]]) {
      const progress = new SectionProgress(sections, 100, 200);
      expect(progress.sectionFractions.every(Number.isFinite)).toBe(true);
      expect(progress.getProgress(0).fraction).toBe(0);
      expect(progress.getSection(0.5)).toEqual([0, 0]);
    }
  });
});

describe("TOC progress", () => {
  test("groups fragments, inherits chapter labels, and handles nested entries", () => withDom(async window => {
    const doc = window.document;
    doc.body.innerHTML = '<p id="a">First</p><p id="b">Second</p>';
    const progress = new TOCProgress<string, string>();
    await progress.init({
      toc: [{ href: "chapter#a", label: "First", subitems: [{ href: "chapter#b", label: "Second" }] }],
      ids: ["chapter", "continuation"],
      splitHref: href => { const [id, fragment] = href.split("#"); return [id, fragment]; },
      getFragment: (doc, fragment) => fragment ? doc.getElementById(fragment) : null,
    });
    const range = doc.createRange();
    range.selectNodeContents(doc.getElementById("b")!);
    expect(progress.getProgress(0, range)?.label).toBe("Second");
    expect(progress.getProgress(1)?.label).toBe("First");
  }));
  test("one broken entry is logged without hiding valid navigation", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const progress = new TOCProgress<string, string>();
      await progress.init({
        toc: [{ href: "bad" }, { href: "chapter", label: "Chapter" }], ids: ["chapter"],
        splitHref: href => { if (href === "bad") throw new Error("Bad destination"); return [href]; },
        getFragment: () => null,
      });
      expect(progress.getProgress(0)?.label).toBe("Chapter");
      expect(warn).toHaveBeenCalledTimes(1);
    } finally { warn.mockRestore(); }
  });
  test("resolves TOC entries concurrently", async () => {
    const resolvers: Array<() => void> = [];
    const progress = new TOCProgress<string, string>();
    const ready = progress.init({
      toc: [{ href: "a" }, { href: "b" }], ids: ["a", "b"],
      splitHref: href => new Promise(resolve => resolvers.push(() => resolve([href]))),
      getFragment: () => null,
    });
    await Promise.resolve();
    expect(resolvers).toHaveLength(2);
    for (const resolve of resolvers) resolve();
    await ready;
    expect(progress.getProgress(1)?.href).toBe("b");
  });
});
