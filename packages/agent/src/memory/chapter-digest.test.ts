import { describe, expect, test } from "bun:test";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { Id } from "@read-aware/core";
import type { ChapterDigest } from "../ports";
import {
  DIGEST_VERSION,
  digestMissingChapters,
  extractChapterDigest,
  mergeCharacterRegistry,
} from "./chapter-digest";

const MODEL = { id: "stub", provider: "stub", api: "openai-completions" } as unknown as Model<Api>;
const BOOK_ID = "book-1" as Id;

function reply(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "stub",
    model: "stub",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  } as AssistantMessage;
}

describe("extractChapterDigest", () => {
  test("parses a valid digest and stamps the pipeline version", async () => {
    const digest = await extractChapterDigest({
      complete: async () =>
        reply(
          '{"summary": "阿辽沙进城见到了父亲。", "characters": [{"name": "阿辽沙", "aliases": ["阿列克塞"], "note": "幼子"}]}',
        ),
      model: MODEL,
      chapterIndex: 3,
      chapterTitle: "第三章",
      chapterText: "正文……",
      knownCharacters: [],
    });
    expect(digest).toEqual({
      chapterIndex: 3,
      summary: "阿辽沙进城见到了父亲。",
      characters: [{ name: "阿辽沙", aliases: ["阿列克塞"], note: "幼子" }],
      digestVersion: DIGEST_VERSION,
    });
  });

  test("model failure or malformed output degrades to undefined", async () => {
    const failed = await extractChapterDigest({
      complete: async () => {
        throw new Error("provider down");
      },
      model: MODEL,
      chapterIndex: 0,
      chapterText: "正文",
      knownCharacters: [],
    });
    expect(failed).toBeUndefined();
    const malformed = await extractChapterDigest({
      complete: async () => reply("我觉得这一章很精彩！"),
      model: MODEL,
      chapterIndex: 0,
      chapterText: "正文",
      knownCharacters: [],
    });
    expect(malformed).toBeUndefined();
  });

  test("empty chapter text never calls the model", async () => {
    let called = false;
    const digest = await extractChapterDigest({
      complete: async () => {
        called = true;
        return reply("{}");
      },
      model: MODEL,
      chapterIndex: 1,
      chapterText: "   ",
      knownCharacters: [],
    });
    expect(digest).toBeUndefined();
    expect(called).toBe(false);
  });
});

describe("mergeCharacterRegistry", () => {
  test("merges same-name characters across chapters, unioning aliases and keeping the latest note", () => {
    const digests: ChapterDigest[] = [
      {
        chapterIndex: 2,
        summary: "b",
        digestVersion: 1,
        characters: [{ name: "米嘉", aliases: ["德米特里"], note: "长子，与父亲争产" }],
      },
      {
        chapterIndex: 1,
        summary: "a",
        digestVersion: 1,
        characters: [{ name: "米嘉", aliases: ["米剑卡"], note: "长子" }],
      },
    ];
    expect(mergeCharacterRegistry(digests)).toEqual([
      { name: "米嘉", aliases: ["米剑卡", "德米特里"], note: "长子，与父亲争产" },
    ]);
  });
});

describe("digestMissingChapters", () => {
  function harness(existing: ChapterDigest[] = []) {
    const saved: Array<{ bookId: Id; digest: ChapterDigest }> = [];
    const digested: number[] = [];
    const deps = {
      bookText: {
        getToc: async () =>
          [0, 1, 2, 3].map((index) => ({
            index,
            title: `第${index}章`,
            chars: 100,
            hrefs: [`ch${index}.html`],
          })),
        getChapterText: async (_bookId: Id, index: number) => `第${index}章正文`,
      },
      bookMemory: {
        listDigests: async () => existing,
        saveDigest: async (bookId: Id, digest: ChapterDigest) => {
          saved.push({ bookId, digest });
        },
      },
      complete: async (_model: unknown, context: { messages: Array<{ content: unknown }> }) => {
        const text = String(context.messages[0]?.content ?? "");
        const match = text.match(/Chapter #(\d+)/);
        digested.push(Number(match?.[1]));
        return reply(`{"summary": "第${match?.[1]}章摘要", "characters": []}`);
      },
    };
    return { deps, saved, digested };
  }

  test("digests only chapters strictly before the reader, respecting the per-call budget", async () => {
    const { deps, saved, digested } = harness();
    const count = await digestMissingChapters({
      ...deps,
      complete: deps.complete as never,
      model: MODEL,
      bookId: BOOK_ID,
      beforeChapterIndex: 3,
      maxChapters: 2,
    });
    expect(count).toBe(2);
    expect(digested).toEqual([0, 1]);
    expect(saved.map((entry) => entry.digest.chapterIndex)).toEqual([0, 1]);
    expect(saved[0]!.digest.chapterHref).toBe("ch0.html");
  });

  test("skips chapters that already carry a current-version digest", async () => {
    const { deps, digested } = harness([
      { chapterIndex: 0, summary: "已有", characters: [], digestVersion: DIGEST_VERSION },
    ]);
    const count = await digestMissingChapters({
      ...deps,
      complete: deps.complete as never,
      model: MODEL,
      bookId: BOOK_ID,
      beforeChapterIndex: 2,
      maxChapters: 5,
    });
    expect(count).toBe(1);
    expect(digested).toEqual([1]);
  });

  test("an outdated digest version is recomputed", async () => {
    const { deps, digested } = harness([
      { chapterIndex: 0, summary: "旧版", characters: [], digestVersion: DIGEST_VERSION - 1 },
    ]);
    await digestMissingChapters({
      ...deps,
      complete: deps.complete as never,
      model: MODEL,
      bookId: BOOK_ID,
      beforeChapterIndex: 1,
      maxChapters: 5,
    });
    expect(digested).toEqual([0]);
  });

  test("reader still in the first chapter digests nothing", async () => {
    const { deps, digested } = harness();
    const count = await digestMissingChapters({
      ...deps,
      complete: deps.complete as never,
      model: MODEL,
      bookId: BOOK_ID,
      beforeChapterIndex: 0,
    });
    expect(count).toBe(0);
    expect(digested).toEqual([]);
  });
});
