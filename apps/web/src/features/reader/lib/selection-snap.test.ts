import { describe, expect, test } from "bun:test";
import { readingUnits, snapSelection, type SelectionSnapInput } from "./selection-snap";

/**
 * Write the selection inside the text with brackets: `"前文。[这是选区]后文"`.
 * Returns the snapped text with the result's brackets, or the input unchanged.
 */
function snap(marked: string, options: Partial<SelectionSnapInput> = {}, blocks: number[] = [0]): string {
  const start = marked.indexOf("[");
  const end = marked.indexOf("]") - 1;
  const text = marked.replace("[", "").replace("]", "");
  const result = snapSelection({ text, blocks, start, end, ...options }) ?? { start, end };
  return `${text.slice(0, result.start)}[${text.slice(result.start, result.end)}]${text.slice(result.end)}`;
}

/** Paragraphs joined by a newline, with their start offsets. */
function paragraphs(...parts: string[]): { marked: string; blocks: number[] } {
  const blocks: number[] = [];
  let offset = 0;
  for (const part of parts) {
    blocks.push(offset);
    offset += part.replace("[", "").replace("]", "").length + 1;
  }
  return { marked: parts.join("\n"), blocks };
}

describe("reading units", () => {
  test("count dense characters one each and spaced words two each", () => {
    expect(readingUnits("这件事")).toBe(3);
    expect(readingUnits("the cat")).toBe(4);
    expect(readingUnits("don't")).toBe(2);
    expect(readingUnits("。”， ")).toBe(0);
  });
});

describe("edges that stop short", () => {
  test("a sentence missing its first character starts at the sentence", () => {
    expect(snap("前面一句。这[件事其实非常重要。]后面一句。")).toBe("前面一句。[这件事其实非常重要。]后面一句。");
  });

  test("a sentence missing its closing punctuation takes it", () => {
    expect(snap("前面一句。[这件事其实非常重要]。后面一句。")).toBe("前面一句。[这件事其实非常重要。]后面一句。");
  });

  test("the closing quote after the punctuation comes too", () => {
    expect(snap("[他说：“我们明天早上就出发。]”她点点头。")).toBe("[他说：“我们明天早上就出发。”]她点点头。");
  });

  test("an opening quote missed at the start is taken for a whole sentence", () => {
    expect(snap("她点点头。“[我们明天早上就出发。”]")).toBe("她点点头。[“我们明天早上就出发。”]");
  });

  test("a quoted sentence missing both quotes and its full stop takes them all", () => {
    expect(snap('"[她父亲认为你是好孩子]。"狄克心不在焉地说。')).toBe('["她父亲认为你是好孩子。"]狄克心不在焉地说。');
    expect(snap("“[她父亲认为你是好孩子]。”狄克心不在焉地说。")).toBe("[“她父亲认为你是好孩子。”]狄克心不在焉地说。");
  });

  test("a phrase that ends a quoted sentence stays without its punctuation", () => {
    expect(snap("“她父亲认为你是[好孩子]。”狄克说。")).toBe("“她父亲认为你是[好孩子]。”狄克说。");
  });

  test("both edges short of a sentence reach both of its ends", () => {
    expect(snap("前面一句。这[件事其实非常重]要。后面一句。")).toBe("前面一句。[这件事其实非常重要。]后面一句。");
  });

  test("a word cut in half is completed", () => {
    expect(snap("Then I said hello w[orld is ro]und.")).toBe("Then I said hello [world is round].");
  });

  test("an English sentence missing its first word starts at the sentence", () => {
    expect(snap("It rained. The [old man walked home slowly.] Then")).toBe(
      "It rained. [The old man walked home slowly.] Then",
    );
  });
});

describe("edges that overshoot", () => {
  test("a character of the next sentence is dropped", () => {
    expect(snap("前面一句。[这件事其实非常重要。后]面一句。")).toBe("前面一句。[这件事其实非常重要。]后面一句。");
  });

  test("the tail of the previous sentence is dropped", () => {
    expect(snap("前面一句。[这件事其实非常重要。]后面一句。")).toBe("前面一句。[这件事其实非常重要。]后面一句。");
    expect(snap("前面一[句。这件事其实非常重要。]后面一句。")).toBe("前面一句。[这件事其实非常重要。]后面一句。");
  });

  test("whitespace and indentation at the edges are trimmed", () => {
    expect(snap("前面一句。[  这件事其实非常重要。\n]")).toBe("前面一句。  [这件事其实非常重要。]\n");
    expect(snap("[　　这件事其实非常重要。]")).toBe("　　[这件事其实非常重要。]");
  });

  test("a dangling comma is dropped", () => {
    expect(snap("[我们明天早上就出发，]然后去车站。")).toBe("[我们明天早上就出发]，然后去车站。");
  });

  test("an overshoot pulls back to the sentence end rather than on to the next clause", () => {
    expect(snap('[他耸耸肩，打开报纸看了起来。"我]猜，这就是人生！"他说。')).toBe(
      '[他耸耸肩，打开报纸看了起来。]"我猜，这就是人生！"他说。',
    );
  });

  test("straight quotes pair up: an opening one belongs to the sentence it opens", () => {
    expect(snap('他耸耸肩。"[我猜，这就是人生]！"他说。')).toBe('他耸耸肩。["我猜，这就是人生！"]他说。');
  });

  test("a word of the next English sentence is dropped", () => {
    expect(snap("[The old man walked home slowly. Then] he slept.")).toBe(
      "[The old man walked home slowly.] Then he slept.",
    );
  });

  test("a character of the next paragraph is dropped", () => {
    const { marked, blocks } = paragraphs("[这件事其实非常重要。", "后]面一段。");
    expect(snap(marked, {}, blocks)).toBe("[这件事其实非常重要。]\n后面一段。");
  });

  test("most of a second paragraph is kept", () => {
    const { marked, blocks } = paragraphs("[这件事其实非常重要。", "后面一段也很重要]。");
    expect(snap(marked, {}, blocks)).toBe("[这件事其实非常重要。\n后面一段也很重要。]");
  });
});

describe("deliberate selections stay", () => {
  test("a phrase in the middle of a sentence", () => {
    expect(snap("他这个做法其实是[画蛇添足]的典型。")).toBe("他这个做法其实是[画蛇添足]的典型。");
  });

  test("a phrase that ends a sentence does not take its full stop", () => {
    expect(snap("他这个做法其实是[画蛇添足]。")).toBe("他这个做法其实是[画蛇添足]。");
  });

  test("a single word, even near the sentence start", () => {
    expect(snap("这[件事]其实非常重要。")).toBe("这[件事]其实非常重要。");
    expect(snap("The [old] man walked.")).toBe("The [old] man walked.");
  });

  test("a clause ends at its comma instead of growing into the sentence", () => {
    expect(snap("[我们明天早上就出]发，然后去车站。")).toBe("[我们明天早上就出发]，然后去车站。");
    // A clause from inside a sentence does not take the sentence's full stop.
    expect(snap("我们明天早上就出发，[然后去火车站坐车]。")).toBe("我们明天早上就出发，[然后去火车站坐车]。");
  });

  test("a short phrase near a sentence start is not taken for a clipped sentence", () => {
    expect(snap("所谓[量子纠缠]是指一种现象。")).toBe("所谓[量子纠缠]是指一种现象。");
    expect(snap("所谓[量子纠缠]是指……。")).toBe("所谓[量子纠缠]是指……。");
  });

  test("a quotation inside a sentence stays a quotation", () => {
    expect(snap("他说“[画蛇添足]”。")).toBe("他说“[画蛇添足]”。");
    expect(snap("他说这是“[画蛇添足]”的典型。")).toBe("他说这是“[画蛇添足]”的典型。");
  });

  test("an exact sentence is unchanged", () => {
    expect(snapSelection({ text: "一。这件事其实非常重要。二。", blocks: [0], start: 2, end: 12 })).toBeNull();
  });

  test("numbers keep their thousands separators", () => {
    expect(snap("[It cost 1,000 dollars] in total.")).toBe("[It cost 1,000 dollars] in total.");
  });
});

describe("selections that run off the visible page", () => {
  test("continue to the end of the sentence", () => {
    expect(snap("前面一句。[这件事其实非]常重要，大家都知道。后面一句。", { continuesAfter: true })).toBe(
      "前面一句。[这件事其实非常重要，大家都知道。]后面一句。",
    );
  });

  test("continue to the end of a paragraph selected from its start", () => {
    const { marked, blocks } = paragraphs("[第一句话在这里。第二句话在]这里。第三句话在这里。", "下一段。");
    expect(snap(marked, { continuesAfter: true }, blocks)).toBe(
      "[第一句话在这里。第二句话在这里。第三句话在这里。]\n下一段。",
    );
  });

  test("continue back to the start of the sentence", () => {
    expect(snap("前面一句。这件事其实[非常重要，大家都知道。]后面一句。", { continuesBefore: true })).toBe(
      "前面一句。[这件事其实非常重要，大家都知道。]后面一句。",
    );
  });

  test("a selection that ends on a sentence end at the page edge is complete", () => {
    const { marked, blocks } = paragraphs("[第一句话在这里。第二句话在这里。]第三句话在这里。", "下一段。");
    expect(snap(marked, { continuesAfter: true }, blocks)).toBe(
      "[第一句话在这里。第二句话在这里。]第三句话在这里。\n下一段。",
    );
  });

  test("a selection that begins on a sentence start at the page top is complete", () => {
    const { marked, blocks } = paragraphs("第一句话在这里。[第二句话在这里。第三句话在这里。]", "下一段。");
    expect(snap(marked, { continuesBefore: true }, blocks)).toBe(
      "第一句话在这里。[第二句话在这里。第三句话在这里。]\n下一段。",
    );
  });

  test("a selection cut off at the page top continues back to its paragraph's start", () => {
    const { marked, blocks } = paragraphs("第一句话在这里。第二句[话在这里。第三句话在这里。]", "下一段。");
    expect(snap(marked, { continuesBefore: true }, blocks)).toBe(
      "[第一句话在这里。第二句话在这里。第三句话在这里。]\n下一段。",
    );
  });

  test("a word at the page edge is not grown into a sentence", () => {
    expect(snap("前面一句。这件事其实[非常]重要。", { continuesAfter: true })).toBe("前面一句。这件事其实[非常]重要。");
  });
});

describe("word mode", () => {
  test("only trims and completes words", () => {
    expect(snap("前面一句。这[件事其实非常重要]。", { mode: "words" })).toBe("前面一句。这[件事其实非常重要]。");
    expect(snap("Hello w[orld is ro]und. ", { mode: "words" })).toBe("Hello [world is round]. ");
  });
});
