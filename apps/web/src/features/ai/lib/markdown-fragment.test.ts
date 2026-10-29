import { expect, test } from "bun:test";
import { fragmentTargetId, isFragmentHref } from "./markdown-fragment";

test("recognizes in-reply fragments but not external or empty hrefs", () => {
  expect(isFragmentHref("#user-content-fn-1")).toBe(true);
  expect(isFragmentHref("#")).toBe(false);
  expect(isFragmentHref("https://example.com/#section")).toBe(false);
  expect(isFragmentHref("streamdown:incomplete-link")).toBe(false);
});

test("maps a footnote href to the sanitizer's re-prefixed id without decoding it", () => {
  expect(fragmentTargetId("#user-content-fn-1")).toBe("user-content-user-content-fn-1");
  expect(fragmentTargetId("#user-content-fnref-%E6%B3%A81")).toBe("user-content-user-content-fnref-%E6%B3%A81");
});
