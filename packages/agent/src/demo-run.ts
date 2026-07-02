/**
 * 真网络运行时 demo：`bun run demo`（packages/agent 下）。
 * fixture 书架 + 内存转录 store + zai-coding-cn 真模型，
 * 依次跑：书线程带工具的一轮 → 追问（验证多轮水化）→ 全局线程跨书一轮。
 */
import { readPiCliKey } from "./dev-key";
import { createAgentRuntime } from "./runtime/runtime";
import type { AnnotationRecord, BookOverview, RuntimeDeps, TurnRecord } from "./ports";
import { threadScopeKey, type ThreadScope } from "./thread-scope";
import type { Id } from "@read-aware/core";

const apiKey = process.env.ZAI_CODING_CN_API_KEY ?? readPiCliKey("zai-coding-cn") ?? "";
if (!apiKey) {
  console.error("no key: set ZAI_CODING_CN_API_KEY or log in via pi CLI");
  process.exit(1);
}

const BOOKS: BookOverview[] = [
  { id: "book-debt" as Id, title: "债：第一个五千年", author: "大卫·格雷伯", progressFraction: 0.42 },
  { id: "book-sapiens" as Id, title: "人类简史", author: "尤瓦尔·赫拉利", progressFraction: 0.9 },
  { id: "book-scale" as Id, title: "规模", author: "杰弗里·韦斯特", progressFraction: 0.05 },
];

const ANNOTATIONS: AnnotationRecord[] = [
  {
    id: "a1",
    bookId: "book-debt" as Id,
    kind: "highlight",
    text: "经济学教科书里的物物交换起源故事，在人类学的田野记录中从未被观察到。",
    chapter: "第二章",
    createdAt: "2026-06-20T10:00:00Z",
  },
  {
    id: "a2",
    bookId: "book-debt" as Id,
    kind: "highlight",
    text: "信用记账早于铸币数千年出现，货币首先是债务的度量单位。",
    chapter: "第三章",
    createdAt: "2026-06-21T10:00:00Z",
  },
  {
    id: "a3",
    bookId: "book-debt" as Id,
    kind: "note",
    text: "暴力与量化：把人从社会关系中抽离，才能被定价。",
    content: "和《人类简史》讲虚构故事的部分对照读",
    chapter: "第五章",
    createdAt: "2026-06-22T10:00:00Z",
  },
];

const turns = new Map<string, TurnRecord[]>();
const deps: RuntimeDeps = {
  library: {
    listBooks: async () => BOOKS,
    getBook: async (id) => BOOKS.find((book) => book.id === id),
  },
  annotations: {
    listAnnotations: async (filter) =>
      ANNOTATIONS.filter(
        (a) =>
          (!filter?.bookId || a.bookId === filter.bookId) &&
          (!filter?.query ||
            a.text.includes(filter.query) ||
            (a.content?.includes(filter.query) ?? false)),
      ),
  },
  conversations: {
    load: async (key) => turns.get(key) ?? [],
    append: async (key, turn) => {
      const list = turns.get(key) ?? [];
      list.push(turn);
      turns.set(key, list);
    },
  },
  profile: {
    getProfileSummary: async () => "偏好第一性原理式的深入讲解，讨厌空话。",
  },
};

const runtime = createAgentRuntime({
  deps,
  account: { kind: "api-key", provider: "zai-coding-cn", apiKey },
  models: { smart: "glm-5-turbo", fast: "glm-4.5-air" },
});

async function run(scope: ThreadScope, text: string): Promise<void> {
  console.log(`\n◆ [${threadScopeKey(scope)}] user: ${text}`);
  for await (const chunk of runtime.sendTurn(scope, { text })) {
    if (chunk.type === "text") process.stdout.write(chunk.text);
    else if (chunk.type === "tool-step" && chunk.phase === "start") {
      console.log(`  ⚙ ${chunk.tool} …`);
    }
  }
  console.log();
}

await run({ kind: "book", bookId: "book-debt" as Id }, "我在这本书里划了哪些重点？共同主题是什么？");
await run({ kind: "book", bookId: "book-debt" as Id }, "把刚才说的主题压缩成一句话。");
await run({ kind: "global" }, "我书架上有哪几本书？哪本读得最深入？");

console.log(`\n(persisted turns: ${[...turns.entries()].map(([k, v]) => `${k}=${v.length}`).join(", ")})`);
