import { describe, expect, test } from "bun:test";
import type { ChatTurnRequest } from "../lib/chat-types";
import { toAgentTurnInput } from "./pi-chat-transport";

describe("pi chat transport mapping", () => {
  test("preserves both selection context and the live reader position", () => {
    const request: ChatTurnRequest = {
      bookId: "book-1",
      bookTitle: "A Book",
      history: [],
      message: {
        id: "message-1",
        role: "user",
        content: "How should I read this?",
        createdAt: "2026-08-02T00:00:00Z",
        attachments: [
          {
            kind: "selection",
            text: "Selected prose",
            cfiRange: "epubcfi(/6/4!/2/2)",
            chapterHref: "chapter-2.xhtml",
          },
        ],
      },
      readingCursor: {
        anchor: "epubcfi(/6/4!/4/2)",
        chapter: "chapter-2.xhtml",
        chapterTitle: "Chapter 2",
        bookProgress: 0.42,
        chapterProgress: 0.6,
        location: { current: 84, total: 200 },
        visibleText: "The page currently visible to the reader.",
      },
    };

    expect(toAgentTurnInput(request)).toEqual({
      text: "How should I read this?",
      attachments: [
        {
          text: "Selected prose",
          anchor: "epubcfi(/6/4!/2/2)",
          chapter: "chapter-2.xhtml",
        },
      ],
      readingCursor: {
        anchor: "epubcfi(/6/4!/4/2)",
        chapter: "chapter-2.xhtml",
        chapterTitle: "Chapter 2",
        bookProgress: 0.42,
        chapterProgress: 0.6,
        location: { current: 84, total: 200 },
        visibleText: "The page currently visible to the reader.",
      },
      signal: undefined,
      reset: undefined,
    });
  });
});
