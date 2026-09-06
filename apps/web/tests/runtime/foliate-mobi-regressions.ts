import type { Book } from "../../foliate-js/src/book";
import { makeKF8Fixture, makeMOBI6Fixture } from "../fixtures/foliate-mobi";

type Modules = { view: typeof import("../../foliate-js/src/view") };
type Result = { name: string; passed: boolean; details?: string };

export async function runMOBIRegressions(modules: Modules, extraFiles: File[] = []): Promise<Result[]> {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("Run inside Tauri");
  const results: Result[] = [];
  const fixtures = [makeMOBI6Fixture().file, makeMOBI6Fixture({ compression: 2 }).file, makeKF8Fixture().file, ...extraFiles];
  for (const [fixtureIndex, file] of fixtures.entries()) {
    const name = `${file.name} (${fixtureIndex}): native text, images, navigation and CFI`;
    const view = new modules.view.View();
    view.style.cssText = "display:block;position:fixed;left:0;top:0;width:900px;height:600px;opacity:0;pointer-events:none;z-index:-1";
    document.body.append(view);
    let book: Book | undefined;
    try {
      book = await modules.view.makeBook(file);
      await view.open(book);
      const index = file.name === "fixture.mobi" ? 2 : 0;
      const href = book.getSectionHref?.(index);
      await view.goTo(href ?? index);
      const content: { doc: Document; index: number } | undefined = view.renderer.getContents()[0];
      if (!content || content.index !== index) throw new Error(`Failed to load section ${index}`);
      for (const image of content.doc.querySelectorAll("img[src]")) {
        if (!image.getAttribute("src")) continue;
        await image.decode();
        if (!image.naturalWidth) throw new Error("Empty MOBI illustration");
      }
      if (file.name === "fixture.azw3") {
        if (content.doc.querySelector("#chapter")?.textContent !== "Hello KF8 中文") throw new Error("Missing KF8 fragment text");
        if (content.doc.defaultView?.getComputedStyle(content.doc.querySelector("p")!).color !== "rgb(23, 45, 67)")
          throw new Error("KF8 CSS flow did not render");
      }
      const walker = content.doc.createTreeWalker(content.doc.body, NodeFilter.SHOW_TEXT, {
        acceptNode: node => node.textContent?.trim() && !node.parentElement?.closest("style,script")
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
      });
      const text = walker.nextNode();
      if (text) {
        const range = content.doc.createRange();
        range.selectNodeContents(text);
        const restored = view.resolveCFI(view.getCFI(index, range)).anchor(content.doc);
        if (restored.toString() !== range.toString()) throw new Error("MOBI CFI selection changed");
      }
      if (book.sections.length > 1) {
        const next = (index + 1) % book.sections.length;
        await view.goTo(book.getSectionHref?.(next) ?? next);
        if (view.renderer.getContents()[0]?.index !== next) throw new Error("MOBI section navigation failed");
      }
      results.push({ name, passed: true });
    } catch (error) { results.push({ name, passed: false, details: String(error) }); }
    finally { view.close(); view.remove(); await book?.destroy?.(); }
  }
  return results;
}
