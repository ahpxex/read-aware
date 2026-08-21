import { describe, expect, test } from "bun:test";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { Id } from "@read-aware/core";
import type { ChapterDigest } from "../ports";
import {
  DIGEST_VERSION,
  digestMissingChapters,
  extractChapterDigest,
  mergeCharacterRegistry,
  mergeRelationGraph,
  resolveEntityNames,
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
          '{"summary": "阿辽沙进城见到了父亲。", "characters": [{"name": "阿辽沙", "aliases": ["阿列克塞"], "note": "幼子"}, {"name": "费奥多尔"}], "relations": [{"from": "费奥多尔", "kind": "父亲", "to": "阿辽沙"}, {"from": "费奥多尔", "kind": "仇敌", "to": "书里没有的人"}, {"from": "阿辽沙", "kind": "自己", "to": "阿辽沙"}]}',
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
      characters: [{ name: "阿辽沙", aliases: ["阿列克塞"], note: "幼子" }, { name: "费奥多尔" }],
      // 未知端点与自环被剪掉——挂空边比缺边更毒
      relations: [{ from: "费奥多尔", kind: "父亲", to: "阿辽沙" }],
      digestVersion: DIGEST_VERSION,
      flavor: "narrative",
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

  test("expository flavor prompts for concepts and accepts the semantic key", async () => {
    let systemPrompt = "";
    const digest = await extractChapterDigest({
      complete: async (_model, context) => {
        systemPrompt = String((context as { systemPrompt?: unknown }).systemPrompt ?? "");
        return reply(
          '{"summary": "本章立论：群体智力低于个体。", "concepts": [{"name": "群体心理", "aliases": ["集体心理"], "note": "个体聚成群后的共同心理状态"}, {"name": "无意识"}], "relations": [{"from": "无意识", "kind": "支配", "to": "群体心理"}]}',
        );
      },
      model: MODEL,
      chapterIndex: 5,
      chapterTitle: "第一章",
      chapterText: "正文……",
      knownCharacters: [],
      flavor: "expository",
    });
    expect(systemPrompt).toContain("NON-FICTION");
    expect(systemPrompt).toContain('"concepts"');
    expect(digest).toEqual({
      chapterIndex: 5,
      summary: "本章立论：群体智力低于个体。",
      characters: [
        { name: "群体心理", aliases: ["集体心理"], note: "个体聚成群后的共同心理状态" },
        { name: "无意识" },
      ],
      relations: [{ from: "无意识", kind: "支配", to: "群体心理" }],
      digestVersion: DIGEST_VERSION,
      flavor: "expository",
    });
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
        relations: [{ from: "米嘉", kind: "儿子", to: "费奥多尔" }],
      },
      {
        chapterIndex: 1,
        summary: "a",
        digestVersion: 1,
        characters: [{ name: "米嘉", aliases: ["米剑卡"], note: "长子" }],
        relations: [{ from: "米嘉", kind: "儿子", to: "费奥多尔" }],
      },
    ];
    expect(mergeCharacterRegistry(digests)).toEqual([
      { name: "米嘉", aliases: ["米剑卡", "德米特里"], note: "长子，与父亲争产" },
    ]);
  });
});

describe("mergeRelationGraph", () => {
  test("keeps the earliest establishing chapter per edge and the latest note", () => {
    const edges = mergeRelationGraph([
      {
        chapterIndex: 7,
        summary: "b",
        characters: [],
        relations: [{ from: "米嘉", kind: "未婚夫", to: "卡捷琳娜", note: "婚约已危" }],
        digestVersion: 2,
      },
      {
        chapterIndex: 3,
        summary: "a",
        characters: [],
        relations: [{ from: "米嘉", kind: "未婚夫", to: "卡捷琳娜" }],
        digestVersion: 2,
      },
    ]);
    expect(edges).toEqual([
      { from: "米嘉", kind: "未婚夫", to: "卡捷琳娜", establishedAt: 3, note: "婚约已危" },
    ]);
  });

  test("tolerates v1 digests without a relations field", () => {
    const edges = mergeRelationGraph([
      { chapterIndex: 0, summary: "旧", characters: [], digestVersion: 1 } as never,
    ]);
    expect(edges).toEqual([]);
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
        return reply(`{"summary": "第${match?.[1]}章摘要", "characters": [], "relations": []}`);
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
      { chapterIndex: 0, summary: "已有", characters: [], relations: [], digestVersion: DIGEST_VERSION },
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
      { chapterIndex: 0, summary: "旧版", characters: [], relations: [], digestVersion: DIGEST_VERSION - 1 },
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

  test("a flavor-mismatched digest is recomputed (book reclassified, or pre-classification narrative rows on an expository book)", async () => {
    const { deps, digested, saved } = harness([
      {
        chapterIndex: 0,
        summary: "人物口径的旧行",
        characters: [{ name: "勒庞" }],
        relations: [],
        digestVersion: DIGEST_VERSION,
        // flavor 缺省 = narrative —— 分类为 expository 后视同缺失
      },
    ]);
    const count = await digestMissingChapters({
      ...deps,
      complete: deps.complete as never,
      model: MODEL,
      bookId: BOOK_ID,
      beforeChapterIndex: 1,
      maxChapters: 5,
      flavor: "expository",
    });
    expect(count).toBe(1);
    expect(digested).toEqual([0]);
    expect(saved[0]!.digest.flavor).toBe("expository");
  });

  test("legacy progress catches up across idle ticks: repeated budgeted calls digest the whole backlog", async () => {
    // 存量用户场景：书已读到第 4 章（beforeChapterIndex=3 之前全部欠账），
    // 纪要管线后上线——每个空闲节拍最多 2 章，几拍之后账清、之后空转。
    const saved: ChapterDigest[] = [];
    const { deps } = (() => {
      const base = harness();
      base.deps.bookMemory = {
        listDigests: async () => [...saved],
        saveDigest: async (_bookId: Id, digest: ChapterDigest) => {
          saved.push(digest);
        },
      };
      return base;
    })();
    const tick = () =>
      digestMissingChapters({
        ...deps,
        complete: deps.complete as never,
        model: MODEL,
        bookId: BOOK_ID,
        beforeChapterIndex: 3,
        maxChapters: 2,
        flavor: "expository",
      });
    expect(await tick()).toBe(2);
    expect(await tick()).toBe(1);
    expect(await tick()).toBe(0); // 账已清——之后的节拍是无害空转
    expect(saved.map((digest) => digest.chapterIndex)).toEqual([0, 1, 2]);
    expect(saved.every((digest) => digest.flavor === "expository")).toBe(true);
  });

  test("the worker pool keeps N chapters in flight and later chapters see completed entities in their anchor registry", async () => {
    const saved: ChapterDigest[] = [];
    const knownBlocks: string[] = [];
    let inFlight = 0;
    let peakInFlight = 0;
    const deps = {
      bookText: {
        getToc: async () =>
          [0, 1, 2, 3, 4].map((index) => ({
            index,
            title: `第${index}章`,
            chars: 100,
            hrefs: [`ch${index}.html`],
          })),
        getChapterText: async (_bookId: Id, index: number) => `第${index}章正文`,
      },
      bookMemory: {
        listDigests: async () => [...saved],
        saveDigest: async (_bookId: Id, digest: ChapterDigest) => {
          saved.push(digest);
        },
      },
      complete: (async (_model: unknown, context: { systemPrompt?: string; messages: Array<{ content: unknown }> }) => {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        knownBlocks.push(String(context.systemPrompt ?? "").split("Characters already known")[1] ?? "");
        const match = String(context.messages[0]?.content ?? "").match(/Chapter #(\d+)/);
        return reply(
          `{"summary": "第${match?.[1]}章摘要", "characters": [{"name": "人物${match?.[1]}"}], "relations": []}`,
        );
      }) as never,
    };
    const count = await digestMissingChapters({
      ...deps,
      model: MODEL,
      bookId: BOOK_ID,
      beforeChapterIndex: 5,
      maxChapters: 10,
      concurrency: 3,
    });
    expect(count).toBe(5);
    expect(peakInFlight).toBe(3); // 滑动窗口确实保持 3 章在飞
    expect(saved.map((digest) => digest.chapterIndex).sort()).toEqual([0, 1, 2, 3, 4]);
    // 起跑的前 3 章在任何完成之前启动——锚名录为空；后续补位的章启动时
    // 已有完成章落库，锚名录携带其实体。
    expect(knownBlocks.slice(0, 3).every((block) => block.includes("(none yet)"))).toBe(true);
    expect(knownBlocks.slice(3).every((block) => !block.includes("(none yet)"))).toBe(true);
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

describe("resolveEntityNames", () => {
  test("merges nickname and full-name fragments via accumulated alias evidence", () => {
    const digests: ChapterDigest[] = [
      {
        chapterIndex: 1,
        summary: "a",
        digestVersion: 2,
        characters: [
          { name: "德米特里·费奥多罗维奇·卡拉马佐夫", aliases: ["米嘉"] },
          { name: "费奥多尔·巴甫洛维奇" },
        ],
        relations: [],
      },
      {
        chapterIndex: 2,
        summary: "b",
        digestVersion: 2,
        characters: [{ name: "米嘉", aliases: ["米剑卡"] }],
        relations: [{ from: "米嘉", kind: "儿子", to: "费奥多尔·巴甫洛维奇" }],
      },
      {
        chapterIndex: 3,
        summary: "c",
        digestVersion: 2,
        characters: [{ name: "米嘉" }],
        relations: [
          { from: "德米特里·费奥多罗维奇·卡拉马佐夫", kind: "儿子", to: "费奥多尔·巴甫洛维奇" },
        ],
      },
    ];
    const resolution = resolveEntityNames(digests);
    // 米嘉提及 2 章 > 全名 1 章 → 规范名是米嘉
    expect(resolution.get("德米特里·费奥多罗维奇·卡拉马佐夫")).toBe("米嘉");
    expect(resolution.get("米剑卡")).toBe("米嘉");
    const registry = mergeCharacterRegistry(digests);
    expect(registry.filter((c) => c.name === "米嘉")).toHaveLength(1);
    // 两条不同拼写的"儿子"边归并为一条，出处戳取最早章
    const edges = mergeRelationGraph(digests);
    expect(edges).toEqual([
      { from: "米嘉", kind: "儿子", to: "费奥多尔·巴甫洛维奇", establishedAt: 2 },
    ]);
  });

  test("never merges two characters listed side by side in the same chapter", () => {
    const digests: ChapterDigest[] = [
      {
        chapterIndex: 1,
        summary: "a",
        digestVersion: 2,
        characters: [
          // 共享姓氏作为别名——歧义证据必须作废，父子不得合并
          { name: "费奥多尔", aliases: ["卡拉马佐夫"] },
          { name: "米嘉", aliases: ["卡拉马佐夫"] },
        ],
        relations: [],
      },
    ];
    const resolution = resolveEntityNames(digests);
    expect(resolution.get("费奥多尔")).toBe("费奥多尔");
    expect(resolution.get("米嘉")).toBe("米嘉");
  });
});
