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
      fence: { throughChapterIndex: -1, readerChapterIndex: 0 },
      visibleText: "眼前只有红岸基地。",
      book: indexed,
    });
    expect(violations.map((item) => item.phrase)).toContain("不要回答");
    expect(violations.map((item) => item.phrase)).toContain("面壁计划");
  });

  test("allows TOC labels, reader-mentioned names, and tool evidence", () => {
    const violations = inspectNarrativeEvidence({
      answer: "目录里有智 子；你提到的罗辑也出现在检索片段“不要回答”里。",
      readerText: "罗辑这个名字是什么意思？",
      fence: { throughChapterIndex: -1, readerChapterIndex: 0 },
      visibleText: "眼前只有红岸基地。",
      toolEvidence: ["不要回答"],
      book: indexed,
    });
    expect(violations).toEqual([]);
  });

  test("rejects an attributed quote absent from this edition", () => {
    const violations = inspectNarrativeEvidence({
      answer: "书中原文是“奇迹神秘权威”。",
      readerText: "概括这段",
      fence: { throughChapterIndex: -1, readerChapterIndex: 0 },
      visibleText: "眼前只有红岸基地。",
      book: indexed,
    });
    expect(violations).toEqual([{ kind: "ungrounded-quote", phrase: "奇迹神秘权威" }]);
  });

  test("catches a near-match formula from another edition", () => {
    const edition = book([
      "眼前的讨论。",
      "大法官把奇迹、秘密和权威作为自己的三种力量。格露莘卡说完便走了。格露莘卡问他。",
    ]);
    const violations = inspectNarrativeEvidence({
      answer: "全篇的核心，是教会用奇迹、神秘和权威换走人的自由。",
      readerText: "解释这一段",
      fence: { throughChapterIndex: -1, readerChapterIndex: 0 },
      visibleText: "眼前的讨论。",
      book: edition,
    });
    expect(violations).toContainEqual({
      kind: "ungrounded-enumeration",
      phrase: "奇迹、神秘和权威",
    });
  });

  test("allows future facts after a verified grant but rejects another edition's name", () => {
    const edition = book(["读者眼前。", "格露莘卡说完便走了。格露莘卡问他，格露莘卡答道。后来案件结束。"]);
    const violations = inspectNarrativeEvidence({
      answer: "后来案件结束，信封是用来勾引格鲁申卡的。",
      readerText: "可以剧透",
      fence: { throughChapterIndex: -1, readerChapterIndex: 0 },
      visibleText: "读者眼前。",
      book: edition,
      allowFuture: true,
    });
    expect(violations).toContainEqual({ kind: "ungrounded-name", phrase: "格鲁申卡" });
    expect(violations.some((item) => item.phrase === "案件结束")).toBe(false);
  });

  test("blocks a future-only outcome label even outside a refusal or progress answer", () => {
    const edition = book(["眼前只介绍了父亲和三个儿子。", "后来发生弑父案件，众人追查真凶。"]);
    const violations = inspectNarrativeEvidence({
      answer: "这一家最后会围绕弑父展开。",
      readerText: "帮我梳理这家人的关系",
      fence: { throughChapterIndex: -1, readerChapterIndex: 0 },
      visibleText: "眼前只介绍了父亲和三个儿子。",
      book: edition,
    });
    expect(violations).toContainEqual({ kind: "future-phrase", phrase: "弑父" });
  });

  test("does not treat recurring discourse words as future character names", () => {
    const repeated = "随即说，随即走，随即来；表面看，表面说，表面走；接着说，接着走，接着来；角度说，角度看，角度来。";
    const edition = book(["眼前的讨论。", repeated + repeated + repeated]);
    const violations = inspectNarrativeEvidence({
      answer: "随即说出判断；表面看起来如此；接着走下去；从这个角度说。",
      readerText: "解释这一段",
      fence: { throughChapterIndex: -1, readerChapterIndex: 0 },
      visibleText: "眼前的讨论。",
      book: edition,
    });
    expect(violations.filter((item) => item.kind === "future-name")).toEqual([]);
  });

  test("does not treat a pronoun-copula phrase as a future character name", () => {
    const repeated = "你是说，你是问，你是答；你是说，你是问，你是答；你是说，你是问，你是答。";
    const edition = book(["眼前的讨论。", repeated]);
    const violations = inspectNarrativeEvidence({
      answer: "如果你是想问某一章，可以告诉我章节号。",
      readerText: "帮我读一下第 999 章，讲讲它的内容。",
      book: edition,
    });
    expect(violations.filter((item) => item.kind === "future-name")).toEqual([]);
  });

  test("still rejects a recurring future character name", () => {
    const repeated = Array.from({ length: 5 }, () => "智子说，智子问，智子答，智子走。").join("");
    const edition = book(["眼前的讨论。", repeated], "第一章");
    const violations = inspectNarrativeEvidence({
      answer: "后来智子说了秘密。",
      readerText: "解释这一段",
      fence: { throughChapterIndex: -1, readerChapterIndex: 0 },
      visibleText: "眼前的讨论。",
      book: edition,
    });
    expect(violations).toContainEqual({ kind: "future-name", phrase: "智子" });
  });

  test("the reader's own chapter is read up to their position and unread after it", () => {
    const chapter = "红岸基地建在雷达峰上。叶文洁第一次走进主控室。不要回答。不要回答。不要回答。";
    const edition = book(["序章只有风。", chapter]);
    const through = chapter.indexOf("不要回答");
    const fence = { throughChapterIndex: 0, readerChapterIndex: 1, readerChapterThrough: through };
    // Text before the position is the reader's own: quoting it needs no tool evidence.
    expect(
      inspectNarrativeEvidence({
        answer: "原文写的是“叶文洁第一次走进主控室”。",
        readerText: "这段在讲什么",
        fence,
        book: edition,
      }),
    ).toEqual([]);
    // Text after it is as unread as a later chapter.
    expect(
      inspectNarrativeEvidence({
        answer: "原文接下来是“不要回答”。",
        readerText: "这段在讲什么",
        fence,
        book: edition,
      }).map((item) => item.phrase),
    ).toEqual(["不要回答"]);
    // Without a position inside the chapter, the whole chapter stays unread.
    expect(
      inspectNarrativeEvidence({
        answer: "原文写的是“叶文洁第一次走进主控室”。",
        readerText: "这段在讲什么",
        fence: { throughChapterIndex: 0, readerChapterIndex: 1 },
        book: edition,
      }).map((item) => item.kind),
    ).toEqual(["future-quote"]);
  });
});
