import { expect, test } from "bun:test";
import type { FoliateView } from "./foliate-engine";
import { captureReadingSelection } from "./selection-range";

const range = {} as Range;
const cfi = "epubcfi(/6/2!/4/2,/1:0,/1:6)";
test("selection identity is captured from its parser, never the later session or an unrelated view", () => {
  const view = { getTextRange: () => ({ cfi }) } as unknown as FoliateView;
  const identity = { view, bookId: "original", contentVersion: "v1", sessionId: "session" };
  const captured = captureReadingSelection(identity, view, 0, range, "needle");
  identity.contentVersion = "v2";
  expect(captured).toMatchObject({ text: "needle", textLength: 6, range: { bookId: "original", contentVersion: "v1", cfi } });
  expect(captured.id).toBeTruthy();
  expect(captureReadingSelection(null, view, 0, range, "needle")).toMatchObject({ range: null, rangeUnavailableReason: "unavailable" });
  expect(captureReadingSelection(identity, {} as FoliateView, 0, range, "needle")).toMatchObject({ range: null, rangeUnavailableReason: "unavailable" });
});

test("long selection previews do not split surrogate pairs or invent a truncated PDF range", () => {
  const text = "a".repeat(11999) + "\u{1F600}more";
  const view = { getTextRange: () => ({ cfi }) } as unknown as FoliateView;
  const identity = { view, bookId: "book", contentVersion: "v1", sessionId: "session" };
  const captured = captureReadingSelection(identity, view, 0, range, text);
  expect(captured.text.length).toBe(11999);
  expect(captured.text.isWellFormed()).toBe(true);
  expect(captured.textLength).toBe(text.length);
  expect(captured.range?.cfi).toBe(cfi);
  view.getTextRange = () => ({ cfi: "epubcfi(/6/2)", textQuote: { exact: text } });
  expect(captureReadingSelection(identity, view, 0, range, text)).toMatchObject({ range: null, rangeUnavailableReason: "too-large" });
  view.getTextRange = () => { throw Error("unanchored source"); };
  expect(captureReadingSelection(identity, view, 0, range, "text")).toMatchObject({ text: "text", range: null, rangeUnavailableReason: "unsupported" });
});
