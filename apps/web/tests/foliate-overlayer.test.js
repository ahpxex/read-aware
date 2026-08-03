import { describe, expect, test } from "bun:test";
import { Overlayer } from "../public/foliate-js/overlayer.js";

class FakeSvgElement {
  style = {};
  children = [];

  append(...elements) {
    this.children.push(...elements);
  }

  removeChild(element) {
    const index = this.children.indexOf(element);
    if (index >= 0) this.children.splice(index, 1);
  }

  getRootNode() {
    return this;
  }
}

describe("foliate overlayer identities", () => {
  test("keeps layers with one hit-test value independently addressable", () => {
    const originalDocument = globalThis.document;
    try {
      globalThis.document = {
        createElementNS: () => new FakeSvgElement(),
      };
      const overlayer = new Overlayer();
      const rect = { left: 10, top: 20, right: 110, bottom: 40 };
      const range = { getClientRects: () => [rect] };
      const draw = () => new FakeSvgElement();

      overlayer.add("saved-mark", range, draw, {}, "shared-cfi");
      overlayer.add("navigator", range, draw, {}, "shared-cfi");

      expect(overlayer.element.children).toHaveLength(2);
      expect(overlayer.hitTest({ x: 20, y: 30 })[0]).toBe("shared-cfi");

      overlayer.remove("navigator");
      expect(overlayer.element.children).toHaveLength(1);
      expect(overlayer.hitTest({ x: 20, y: 30 })[0]).toBe("shared-cfi");
    } finally {
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
    }
  });
});
