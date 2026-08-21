import { describe, expect, test } from "bun:test";
import { inspectNarrativeEvidence, normalizeEvidenceText, type NarrativeBookIndex } from "./narrative-evidence";

function book(chapters: string[], toc = "第一章\n智子"): NarrativeBookIndex {
  return {
    chapterTexts: chapters,
    normalizedChapters: chapters.map(normalizeEvidenceText),
    tocText: toc,
    normalizedToc: normalizeEvidenceText(toc),
  };
}

describe("narrative evidence boundary", () => {
  const indexed = book([
    "眼前只有红岸基地。",
    "不要回答。不要回答。不要回答。面壁计划开始，面壁计划继续，面壁计划推进，面壁计划宣布，面壁计划执行，面壁计划受阻，面壁计划重启，面壁计划结束。罗辑说完后，罗辑问他，罗辑答道，罗辑走开。",
  ]);

  test("normalizes spacing and punctuation", () => {
    expect(normalizeEvidenceText("面 壁，计划")).toBe("面壁计划");
  });

  test("blocks future-only quotations and recurring phrases", () => {
    const violations = inspectNarrativeEvidence({
      answer: "我不剧透，但原文是“不要回答”，之后还有面壁计划。",
      readerText: "讲讲眼前内容",
      cursor: { chapterIndex: 0, visibleText: "眼前只有红岸基地。" },
      book: indexed,
    });
    expect(violations.map((item) => item.phrase)).toContain("不要回答");
    expect(violations.map((item) => item.phrase)).toContain("面壁计划");
  });

  test("allows TOC labels, reader-mentioned names, and tool evidence", () => {
    const violations = inspectNarrativeEvidence({
      answer: "目录里有智 子；你提到的罗辑也出现在检索片段“不要回答”里。",
      readerText: "罗辑这个名字是什么意思？",
      cursor: { chapterIndex: 0, visibleText: "眼前只有红岸基地。" },
      toolEvidence: ["不要回答"],
      book: indexed,
    });
    expect(violations).toEqual([]);
  });

  test("rejects an attributed quote absent from this edition", () => {
    const violations = inspectNarrativeEvidence({
      answer: "书中原文是“奇迹神秘权威”。",
      readerText: "概括这段",
      cursor: { chapterIndex: 0, visibleText: "眼前只有红岸基地。" },
      book: indexed,
    });
    expect(violations).toEqual([
      { kind: "ungrounded-quote", phrase: "奇迹神秘权威" },
    ]);
  });

  test("catches a near-match formula from another edition", () => {
    const edition = book([
      "眼前的讨论。",
      "大法官把奇迹、秘密和权威作为自己的三种力量。格露莘卡说完便走了。格露莘卡问他。",
    ]);
    const violations = inspectNarrativeEvidence({
      answer: "全篇的核心，是教会用奇迹、神秘和权威换走人的自由。",
      readerText: "解释这一段",
      cursor: { chapterIndex: 0, visibleText: "眼前的讨论。" },
      book: edition,
    });
    expect(violations).toContainEqual({
      kind: "ungrounded-enumeration",
      phrase: "奇迹、神秘和权威",
    });
  });

  test("allows future facts after a verified grant but rejects another edition's name", () => {
    const edition = book([
      "读者眼前。",
      "格露莘卡说完便走了。格露莘卡问他，格露莘卡答道。后来案件结束。",
    ]);
    const violations = inspectNarrativeEvidence({
      answer: "后来案件结束，信封是用来勾引格鲁申卡的。",
      readerText: "可以剧透",
      cursor: { chapterIndex: 0, visibleText: "读者眼前。" },
      book: edition,
      allowFuture: true,
    });
    expect(violations).toContainEqual({ kind: "ungrounded-name", phrase: "格鲁申卡" });
    expect(violations.some((item) => item.phrase === "案件结束")).toBe(false);
  });

  test("blocks a future-only outcome label even outside a refusal or progress answer", () => {
    const edition = book([
      "眼前只介绍了父亲和三个儿子。",
      "后来发生弑父案件，众人追查真凶。",
    ]);
    const violations = inspectNarrativeEvidence({
      answer: "这一家最后会围绕弑父展开。",
      readerText: "帮我梳理这家人的关系",
      cursor: { chapterIndex: 0, visibleText: "眼前只介绍了父亲和三个儿子。" },
      book: edition,
    });
    expect(violations).toContainEqual({ kind: "future-phrase", phrase: "弑父" });
  });
});
