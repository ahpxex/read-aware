import { describe, expect, test } from "bun:test";
import type { ThreadChunk } from "../chunks";
import { evaluateReadingBehavior } from "./reading-behavior";

describe("reading behavior evaluation", () => {
  test("reports both answer leaks and the retrieval path", () => {
    const chunks: ThreadChunk[] = [
      {
        type: "tool-step",
        phase: "start",
        id: "call-1",
        tool: "read_chapter",
        args: { chapterIndex: 2 },
      },
      { type: "text", text: "The later reveal names Rowan." },
    ];

    const result = evaluateReadingBehavior(chunks, {
      mustNotContain: ["Rowan"],
      forbiddenTools: ["read_chapter", "search_book_text"],
    });

    expect(result.failures).toEqual([
      'answer contained forbidden phrase: "Rowan"',
      "forbidden tool ran: read_chapter",
    ]);
  });

  test("accepts an explicit-spoiler answer grounded by a text tool", () => {
    const chunks: ThreadChunk[] = [
      {
        type: "tool-step",
        phase: "start",
        id: "call-1",
        tool: "search_book_text",
        args: { queries: ["killer reveal"] },
      },
      { type: "text", text: "The later confession identifies Rowan." },
    ];

    expect(
      evaluateReadingBehavior(chunks, {
        mustContain: ["Rowan"],
        requiredAnyTool: ["read_chapter", "search_book_text"],
      }).failures,
    ).toEqual([]);
  });
});
