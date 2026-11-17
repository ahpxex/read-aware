import { describe, expect, test } from "bun:test";
import type { Id } from "@read-aware/core";
import { buildSystemPrompt } from "./system-prompt";
import { SPOILER_POLICY } from "./spoiler-policy";

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
    expect(prompt).toContain("Protect fictional plot discoveries");
    expect(prompt).toContain("END of the newest cursor's position");
    expect(prompt).toContain("whether it comes from a tool result or from your own memory of the book");
    expect(prompt).toContain("read_chapter returns the reader's own chapter up to their position");
    expect(prompt).toContain("never search the current or later chapters");
    expect(prompt).toContain("do not read_chapter the current chapter");
    expect(prompt).toContain(SPOILER_POLICY.requestAccess);
    expect(prompt).toContain(SPOILER_POLICY.answerFromText);
    expect(prompt).not.toContain("confirmSpoiler");
    expect(prompt).toContain("Factual history, politics, biography, memoir");
    expect(prompt).toContain("Do not restate the same plan");
    expect(prompt).not.toContain("present them as cards");
  });

  test("the reading position line is unconditional, honest about the unknown state", () => {
    const known = buildSystemPrompt(
      { kind: "book", bookId: "book-1" as Id },
      {
        book: { id: "book-1" as Id, title: "The Example", status: "reading", progressPercent: 40 },
        currentChapter: { index: 4, title: "The Turn" },
      },
    );
    expect(known).toContain(
      'Reading position: about 40% through the book; currently at zero-based chapterIndex 4 ("The Turn")',
    );
    expect(known).not.toContain("chapter #4");
    expect(known).toContain("original title from get_toc/read_chapter/search_book_text");

    const progressOnly = buildSystemPrompt(
      { kind: "book", bookId: "book-1" as Id },
      { book: { id: "book-1" as Id, title: "The Example", status: "reading", progressPercent: 40 } },
    );
    expect(progressOnly).toContain("Reading position: about 40% through the book.");
    expect(progressOnly).toContain("The current chapter is not identified");

    const unknown = buildSystemPrompt(
      { kind: "book", bookId: "book-1" as Id },
      { book: { id: "book-1" as Id, title: "The Example", status: "reading" } },
    );
    expect(unknown).toContain("Reading position: not recorded.");
    expect(unknown).toContain("ask where the reader is before revealing narrative content");
    expect(unknown).toContain("cannot add position information beyond this line");
  });

  test("tells the model when the reader has marked the book finished", () => {
    const prompt = buildSystemPrompt(
      { kind: "book", bookId: "book-1" as Id },
      { book: { id: "book-1" as Id, title: "The Example", status: "finished" } },
    );

    expect(prompt).toContain("The reader has marked this book finished.");
  });

  test("available chapter summaries preserve evidence without inventing reading history", () => {
    for (const flavor of ["narrative", "expository"] as const) {
      const prompt = buildSystemPrompt(
        { kind: "book", bookId: "book-1" as Id },
        {
          book: { id: "book-1" as Id, title: "Jumped ahead", status: "reading", narrativity: flavor },
          currentChapter: { index: 4, title: "Later section" },
          chapterDigests: [
            {
              chapterIndex: 0,
              summary: "Earlier source evidence",
              characters: [],
              relations: [],
              flavor,
              digestVersion: 2,
            },
          ],
        },
      );
      expect(prompt).toContain("Earlier source evidence");
      expect(prompt).toContain("not a record of chapters the reader has completed");
      expect(prompt).not.toContain("chapters the reader has finished");
      expect(prompt).not.toContain("Recent finished chapters");
      expect(prompt).not.toContain("The reader has marked this book finished.");
    }
  });

  test("keeps shelf cards on the global surface", () => {
    const prompt = buildSystemPrompt({ kind: "global", threadId: "thread-1" }, { shelfSize: 3 });

    expect(prompt).toContain("present them as cards");
    expect(prompt).not.toContain("Apply spoiler protection selectively");
  });
});
