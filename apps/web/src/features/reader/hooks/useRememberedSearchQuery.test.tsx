import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { readSearchQuery, writeSearchQuery } from "../lib/book-search-memory";
import { useRememberedSearchQuery } from "./useRememberedSearchQuery";

test("the search query starts from the book's last one and is kept when typing settles or the panel closes", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const saved = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

  let current = "";
  let type!: (query: string) => void;
  function Harness({ bookId }: { bookId: string }) {
    const [query, setQuery] = useRememberedSearchQuery(bookId);
    current = query;
    type = setQuery;
    return null;
  }
  const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    await writeSearchQuery("book-a", "waxwing");
    await act(async () => root.render(createElement(Harness, { bookId: "book-a" })));
    expect(current).toBe("waxwing");

    // Stored once typing settles, trimmed.
    await act(async () => type("azure "));
    expect(readSearchQuery("book-a")).toBe("waxwing");
    await wait(450);
    expect(readSearchQuery("book-a")).toBe("azure");

    // Another book starts from its own query; switching keeps the first
    // book's unsettled text.
    await act(async () => type("shadow"));
    await act(async () => root.render(createElement(Harness, { bookId: "book-b" })));
    expect(current).toBe("");
    expect(readSearchQuery("book-a")).toBe("shadow");

    // Closed before typing settled: still kept. Emptied: forgotten.
    await act(async () => type("pale fire"));
    await act(async () => root.render(null));
    expect(readSearchQuery("book-b")).toBe("pale fire");
    await act(async () => root.render(createElement(Harness, { bookId: "book-b" })));
    expect(current).toBe("pale fire");
    await act(async () => type(""));
    await wait(450);
    expect(localStorage.getItem("read-aware-book-search:book-b")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
