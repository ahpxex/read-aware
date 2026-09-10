import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { focusReaderElement } from "./reader-focus-target";

test("DOM focus is exact, does not scroll, and will not bypass hidden panels or foreground dialogs/menus", () => {
  const dom = new JSDOM('<main tabindex="-1"></main><section><textarea>draft</textarea></section><div role="dialog" tabindex="-1"></div>');
  const document = dom.window.document;
  const content = document.querySelector("main")!, section = document.querySelector("section")!;
  const composer = document.querySelector("textarea")!, modal = document.querySelector<HTMLElement>('[role="dialog"]')!;
  // jsdom has focus behavior but no layout engine; rectangle visibility is a fixture.
  for (const node of [content, section, composer, modal]) Object.defineProperty(node, "getClientRects", { value: () => [{ width: 100, height: 40 }] });
  let options: FocusOptions | undefined;
  const focus = content.focus.bind(content);
  content.focus = value => { options = value; focus(value); };
  try {
    modal.hidden = true;
    expect(focusReaderElement(content)).toEqual({ status: "focused" });
    expect(document.activeElement).toBe(content); expect(options).toEqual({ preventScroll: true });
    section.setAttribute("inert", "");
    expect(focusReaderElement(composer)).toEqual({ status: "not-focused", reason: "hidden" });
    section.removeAttribute("inert"); section.style.opacity = "0";
    expect(focusReaderElement(composer)).toMatchObject({ reason: "hidden" }); section.style.opacity = "1";
    modal.hidden = false; modal.focus();
    expect(focusReaderElement(content)).toEqual({ status: "not-focused", reason: "blocked" });
    expect(document.activeElement).toBe(modal);
    modal.setAttribute("role", "menu"); expect(focusReaderElement(composer)).toMatchObject({ reason: "blocked" });
    modal.hidden = true;
    expect(focusReaderElement(composer)).toEqual({ status: "focused" });
    expect(composer.value).toBe("draft");
    composer.remove(); expect(focusReaderElement(composer)).toMatchObject({ reason: "missing" });
  } finally { dom.window.close(); }
});
