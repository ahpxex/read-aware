import { expect, test } from "bun:test";
import { bookMetadataPatch } from "./book-metadata-patch";

test("explicit empty author clears it while omitted fields retain their current values", () => {
  const current = { title: "Book", author: "Author" };
  expect(bookMetadataPatch(current, { author: "" })).toEqual({ author: "" });
  expect(bookMetadataPatch(current, { author: "   " })).toEqual({ author: "" });
  expect(bookMetadataPatch(current, {})).toEqual({});
  expect(bookMetadataPatch(current, { title: "New" })).toEqual({ title: "New" });
});

test("blank title retains the book title; unchanged and padded metadata do not emit redundant fields", () => {
  const current = { title: "Book", author: "Author" };
  expect(bookMetadataPatch(current, { title: " ", author: " Author " })).toEqual({});
  expect(bookMetadataPatch(current, { title: " New ", author: " Other " })).toEqual({ title: "New", author: "Other" });
  expect(bookMetadataPatch({ title: "Book", author: "" }, { author: "" })).toEqual({});
});
