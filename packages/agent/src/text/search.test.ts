import { describe, expect, test } from "bun:test";
import { searchChapters } from "./search";

const CHAPTERS = [
  {
    title: "第二章 以物易物的神话",
    text: "亚当·斯密设想的以物易物经济从未在任何田野记录中被观察到。人类学家发现的是信用、礼物与再分配。",
  },
  {
    title: "第五章 宗教大法官",
    text: "伊万对阿辽沙讲述了他构想的长诗：十六世纪的塞维利亚，宗教大法官逮捕了再临人间的基督。自由与面包的争论贯穿始终。",
  },
];

describe("searchChapters", () => {
  test("多查询合并，精确命中带偏移与片段", () => {
    const hits = searchChapters(CHAPTERS, ["宗教大法官", "不存在的词"]);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].chapterIndex).toBe(1);
    expect(hits[0].match).toBe("exact");
    expect(hits[0].snippet).toContain("宗教大法官");
    expect(CHAPTERS[1].text.slice(hits[0].offset, hits[0].offset + 5)).toBe("宗教大法官");
  });

  test("精确 miss 时词元回退命中（partial）", () => {
    // 原文没有这个连续短语，但"伊万""基督"都在第五章
    const hits = searchChapters(CHAPTERS, ["伊万 基督 长诗"]);
    expect(hits.length).toBe(1);
    expect(hits[0].chapterIndex).toBe(1);
    expect(hits[0].match).toBe("partial");
  });

  test("同一处命中跨查询去重", () => {
    const hits = searchChapters(CHAPTERS, ["以物易物", "以物易物经济"]);
    expect(hits.filter((hit) => hit.chapterIndex === 0).length).toBe(1);
  });

  test("空查询集返回空", () => {
    expect(searchChapters(CHAPTERS, ["  "])).toEqual([]);
  });
});
