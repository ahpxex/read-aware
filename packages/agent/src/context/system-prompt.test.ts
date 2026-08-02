import { describe, expect, test } from "bun:test";
import type { Id } from "@read-aware/core";
import { buildSystemPrompt } from "./system-prompt";

describe("book system prompt", () => {
  test("protects narrative books without treating expository books like plots", () => {
    const prompt = buildSystemPrompt(
      { kind: "book", bookId: "book-1" as Id },
      {
        book: {
          id: "book-1" as Id,
          title: "The Example",
          status: "reading",
          progressPercent: 40,
        },
        currentChapter: { index: 4, title: "The Turn" },
      },
    );

    expect(prompt).toContain("Apply spoiler protection selectively");
    expect(prompt).toContain("literature or another strongly narrative work");
    expect(prompt).toContain("END of the newest cursor's visible_text");
    expect(prompt).toContain("whether it comes from a tool result or your general knowledge");
    expect(prompt).toContain("compare the tool's ENTIRE possible return range");
    expect(prompt).toContain("NEVER call read_chapter on the current narrative chapter");
    expect(prompt).toContain("NEVER search the current or later narrative chapters");
    expect(prompt).toContain("explicitly requests spoilers, answer directly");
    expect(prompt).toContain("do not add an unnecessary permission step");
    expect(prompt).toContain("include unread text after the viewport");
    expect(prompt).toContain("technical, reference, instructional, argumentative");
    expect(prompt).toContain("do not impose a spoiler boundary");
    expect(prompt).toContain("Do not restate the same plan");
    expect(prompt).not.toContain("present them as cards");
  });

  test("tells the model when the reader has marked the book finished", () => {
    const prompt = buildSystemPrompt(
      { kind: "book", bookId: "book-1" as Id },
      { book: { id: "book-1" as Id, title: "The Example", status: "finished" } },
    );

    expect(prompt).toContain("The reader has marked this book finished.");
  });

  test("keeps shelf cards on the global surface", () => {
    const prompt = buildSystemPrompt(
      { kind: "global", threadId: "thread-1" },
      { shelfSize: 3 },
    );

    expect(prompt).toContain("present them as cards");
    expect(prompt).not.toContain("Apply spoiler protection selectively");
  });
});
