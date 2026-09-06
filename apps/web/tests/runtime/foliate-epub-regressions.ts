import type { Book } from "../../foliate-js/src/book";
import { makeEPUBFixture } from "../fixtures/foliate-epub";

type Modules = {
  epub: typeof import("../../foliate-js/src/epub");
  view: typeof import("../../foliate-js/src/view");
};
type Result = { name: string; passed: boolean; details?: string };

export async function runEPUBRegressions(modules: Modules): Promise<Result[]> {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("Run inside Tauri");
  const results: Result[] = [];
  const check = async (name: string, run: () => Promise<void>) => {
    try { await run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, details: String(error) }); }
  };
  const equal = (actual: unknown, expected: unknown) => {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  };
  const mount = () => {
    const view = new modules.view.View();
    view.style.cssText = "display:block;position:fixed;left:0;top:0;width:900px;height:600px;opacity:0;pointer-events:none;z-index:-1";
    document.body.append(view);
    return view;
  };
  await check("EPUB native CSS, SVG, grouped TOC, notes and element CFI selections", async () => {
    const book = await new modules.epub.EPUB(makeEPUBFixture().archive).init();
    const view = mount();
    try {
      await view.open(book);
      await view.goTo(0);
      const doc: Document | undefined = view.renderer.getContents()[0]?.doc;
      if (!doc) throw new Error("Missing EPUB content document");
      equal(doc.defaultView?.getComputedStyle(doc.body).color, "rgb(12, 34, 56)");
      const image = doc.querySelector("img");
      if (!image) throw new Error("Missing EPUB image");
      await image.decode();
      equal(image.naturalWidth, 32);
      const range = doc.createRange();
      range.selectNodeContents(doc.querySelector("em")!);
      const target = view.resolveCFI(view.getCFI(0, range));
      equal(target.anchor(doc).toString(), "EPUB");
      await view.goTo("OPS/two.xhtml#note");
      equal(view.renderer.getContents()[0]?.index, 1);
      equal(view.renderer.getContents()[0]?.doc.querySelector("aside")?.textContent, "Footnote text.");
    } finally { view.close(); view.remove(); book.destroy(); }
  });

  for (const name of ["santi", "karamazov", "lebon", "refactoring", "berger"]) {
    await check(`EPUB existing fixture ${name}: ZIP, first chapter, resources and CFI`, async () => {
      const response = await fetch(`/@fs/Users/ahpx/Code/read-aware/packages/agent/fixtures/${name}.epub`);
      if (!response.ok) throw new Error(`Fixture read failed: ${response.status}`);
      const book: Book = await modules.view.makeBook(new File([await response.blob()], `${name}.epub`));
      const view = mount();
      try {
        if (!book.sections.length) throw new Error("Book has no sections");
        await view.open(book);
        const index = book.sections.findIndex(section => section.linear !== "no");
        await view.goTo(index);
        const content: { doc: Document; index: number } | undefined = view.renderer.getContents()[0];
        if (!content) throw new Error("First chapter did not load");
        equal(content.index, index);
        for (const img of content.doc.querySelectorAll("img")) {
          // Some repository books have missing illustrations in their ZIP.
          // The deterministic fixture above requires a successfully decoded SVG.
          if (img.getAttribute("src")) await img.decode();
        }
        const walker = content.doc.createTreeWalker(content.doc.body, NodeFilter.SHOW_TEXT, {
          acceptNode: node => node.textContent?.trim() && !node.parentElement?.closest("script,style")
            ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
        });
        const text = walker.nextNode();
        if (text) {
          const range = content.doc.createRange();
          range.selectNodeContents(text);
          equal(view.resolveCFI(view.getCFI(index, range)).anchor(content.doc).toString(), range.toString());
        }
      } finally { view.close(); view.remove(); await book.destroy?.(); }
    });
  }
  return results;
}
