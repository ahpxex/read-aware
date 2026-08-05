import { describe, expect, test } from "bun:test";
import { parseFileName } from "./book-file-name";

describe("parseFileName", () => {
  test("splits Title - Author and title-cases", () => {
    expect(parseFileName("thinking fast and slow - daniel kahneman.pdf")).toEqual({
      title: "Thinking Fast And Slow",
      author: "Daniel Kahneman",
    });
  });

  test("drops site tags, tracker domains, and dupe counters", () => {
    expect(parseFileName("Atomic Habits (z-lib.org) (2).pdf").title).toBe("Atomic Habits");
    expect(parseFileName("[www.jiumodiary.com]深度学习入门.pdf").title).toBe("深度学习入门");
    expect(parseFileName("OceanofPDF.com_The_Pragmatic_Programmer.pdf").title).toBe(
      "The Pragmatic Programmer",
    );
  });

  test("drops bracketed years and trailing versions, keeps title years", () => {
    expect(parseFileName("Deep Work (2016) v2.pdf").title).toBe("Deep Work");
    expect(parseFileName("1984 - George Orwell.epub")).toEqual({
      title: "1984",
      author: "George Orwell",
    });
  });

  test("keeps meaningful bracketed notes", () => {
    expect(parseFileName("Pride and Prejudice (Illustrated).epub").title).toBe(
      "Pride And Prejudice (Illustrated)",
    );
  });

  test("treats dots as separators only in space-less names", () => {
    expect(parseFileName("Deep.Learning.with.Python.pdf").title).toBe(
      "Deep Learning With Python",
    );
    expect(parseFileName("Dr. Strange Tales.pdf").title).toBe("Dr. Strange Tales");
  });

  test("bares stacked book extensions", () => {
    expect(parseFileName("Собрание сочинений.fb2.zip").title).toBe("Собрание сочинений");
  });

  test("junk-only names fall back rather than showing residue", () => {
    expect(parseFileName("(z-lib.org).pdf").title).toBe("Untitled");
  });

  test("release-noise brackets vanish, CJK brackets included", () => {
    expect(parseFileName("三体【精校版】.epub").title).toBe("三体");
    expect(parseFileName("Clean Code [OCR] [retail].pdf").title).toBe("Clean Code");
  });
});
