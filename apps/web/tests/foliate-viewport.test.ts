import { expect, test } from "bun:test";
import { getViewport, parseViewport } from "../foliate-js/src/viewport.js";
import { withDom } from "./helpers/foliate-dom.js";

test("fixed-layout viewport strings become dimensions, not key/value arrays", () => {
  expect(parseViewport("width=600,height=800")).toEqual({ width: 600, height: 800 });
  expect(parseViewport("width=600; height=800")).toEqual({ width: 600, height: 800 });
  expect(parseViewport({ width: "600", height: 800 })).toEqual({ width: 600, height: 800 });
  expect(parseViewport("width=device-width,height=800")).toBeUndefined();
  expect(parseViewport({ width: 0, height: -1 })).toBeUndefined();
});

test("SVG, page metadata and book fallback dimensions preserve their precedence", () => withDom(window => {
  const svg = new window.DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,300,400"/>', "image/svg+xml");
  expect(getViewport(svg, "width=600,height=800")).toEqual({ width: 300, height: 400 });
  const doc = window.document;
  doc.head.innerHTML = '<meta name="viewport" content="width=720,height=960">';
  expect(getViewport(doc, "width=600,height=800")).toEqual({ width: 720, height: 960 });
  doc.head.replaceChildren();
  expect(getViewport(doc, "width=600,height=800")).toEqual({ width: 600, height: 800 });
}));
