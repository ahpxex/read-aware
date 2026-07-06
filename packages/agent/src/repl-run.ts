/**
 * Headless 交互调试台：`bun run repl [provider] [model]`（packages/agent 下）。
 * 不经过任何 UI —— fixture 书架 + 内存 store + 真模型，逐轮流式打印
 * thinking / 工具调用（含入参与耗时）/ 正文，并提供检查内部状态的命令：
 *
 *   :books              fixture 书架
 *   :book <id>          切到某本书的线程
 *   :global             切回全局线程（默认）
 *   :sys                打印当前 scope 下一轮将使用的 system prompt
 *   :memories           长期记忆 store
 *   :turns              各线程已持久化的轮数
 *   :asks               ask-note 留痕
 *   :flush              等待轮后管道（记忆提炼 + 滚动摘要）排空
 *   :consolidate        跑一次巩固批处理并打印报告
 *   :quit               退出
 *
 * key 解析与 spike/demo 一致：`<PROVIDER>_API_KEY` 环境变量 → pi CLI 的
 * ~/.pi/agent/auth.json。
 */
import readline from "node:readline/promises";
import type { Id } from "@read-aware/core";
import { buildSystemPrompt } from "./context/system-prompt";
import { readPiCliKey } from "./dev-key";
import type { KnownProviderId } from "./models/registry";
import type { AnnotationRecord, BookOverview } from "./ports";
import { createAgentRuntime } from "./runtime/runtime";
import { createInMemoryDeps, type ChapterSeed } from "./testing/fixtures";
import { threadScopeKey, type ThreadScope } from "./thread-scope";
import { visibleScopes } from "./tools/memory-tools";

const ENV_KEYS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  zai: "ZAI_API_KEY",
  "zai-coding-cn": "ZAI_CODING_CN_API_KEY",
};
const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-4o-mini",
  openrouter: "openai/gpt-4o-mini",
  zai: "glm-5.2",
  "zai-coding-cn": "glm-5.2",
};

const provider = process.argv[2] ?? "zai-coding-cn";
if (!(provider in ENV_KEYS)) {
  console.error(`unknown provider "${provider}" — one of: ${Object.keys(ENV_KEYS).join(", ")}`);
  process.exit(1);
}
const model = process.argv[3] ?? DEFAULT_MODELS[provider];
const apiKey = process.env[ENV_KEYS[provider]] ?? readPiCliKey(provider) ?? "";
if (!apiKey) {
  console.error(`no API key for ${provider}: set ${ENV_KEYS[provider]} or log in via pi CLI`);
  process.exit(1);
}

// ── fixture 世界：与 demo-run 同一批书 + 少量正文，让全部工具都有的可查 ──

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

const CHAPTERS: Record<string, ChapterSeed[]> = {
  "book-debt": [
    {
      title: "第一章 论道德混乱的经验",
      text: "欠债还钱是道德常识，但历史上每一次债务危机都以某种形式的豁免收场。本章从 2008 年金融危机谈起，追问为什么欠钱不还在道德上如此难以辩护，而放贷者的责任却很少被讨论。",
    },
    {
      title: "第二章 以物易物的神话",
      text: "亚当·斯密设想的以物易物经济从未在任何田野记录中被观察到。人类学家发现的是信用、礼物与再分配。物物交换只发生在陌生人之间或货币体系崩溃之后，它是货币的产物而非起源。",
    },
  ],
};

const { deps, stores } = createInMemoryDeps({
  books: BOOKS,
  annotations: ANNOTATIONS,
  chapters: CHAPTERS,
  profile: "偏好第一性原理式的深入讲解，讨厌空话。",
});

const runtime = createAgentRuntime({
  deps,
  account: { kind: "api-key", provider: provider as KnownProviderId, apiKey },
  models: { smart: model, fast: model },
});

// ── 输出：正文原样，元信息（thinking / 工具）走 dim ──

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

async function runTurn(scope: ThreadScope, text: string): Promise<void> {
  const toolStarts = new Map<string, number>();
  // 当前流的通道：thinking 与 text 交错时负责换行与去/加 dim
  let channel: "idle" | "thinking" | "text" = "idle";
  const switchChannel = (next: "thinking" | "text") => {
    if (channel === next) return;
    if (channel !== "idle") process.stdout.write(`${RESET}\n`);
    if (next === "thinking") process.stdout.write(`${DIM}[thinking] `);
    channel = next;
  };

  try {
    for await (const chunk of runtime.sendTurn(scope, { text })) {
      switch (chunk.type) {
        case "thinking":
          switchChannel("thinking");
          process.stdout.write(chunk.text);
          break;
        case "text":
          switchChannel("text");
          process.stdout.write(chunk.text);
          break;
        case "tool-step":
          if (channel !== "idle") process.stdout.write(`${RESET}\n`);
          channel = "idle";
          if (chunk.phase === "start") {
            toolStarts.set(chunk.id, performance.now());
            const args = chunk.args === undefined ? "" : ` ${JSON.stringify(chunk.args)}`;
            process.stdout.write(`${DIM}[tool] ${chunk.tool}${args}${RESET}\n`);
          } else {
            const started = toolStarts.get(chunk.id);
            const elapsed = started === undefined ? "" : ` ${Math.round(performance.now() - started)}ms`;
            const status = chunk.isError ? "failed" : "ok";
            process.stdout.write(`${DIM}[tool] ${chunk.tool} → ${status}${elapsed}${RESET}\n`);
          }
          break;
        default:
          break;
      }
    }
  } finally {
    if (channel !== "idle") process.stdout.write(`${RESET}\n`);
  }
}

// ── 状态检查命令 ──

async function printSystemPrompt(scope: ThreadScope): Promise<void> {
  // 与 AgentThread.refreshSystemPrompt 同构（访谈模式以“该线程还没有持久化轮次”近似）
  const key = threadScopeKey(scope);
  const [profile, book, shelf, memories, conversationSummary, turns] = await Promise.all([
    deps.profile.getProfileSummary(),
    scope.kind === "book" ? deps.library.getBook(scope.bookId) : undefined,
    scope.kind === "global" ? deps.library.listBooks() : undefined,
    deps.memory.searchMemories({ scopes: visibleScopes(scope), limit: 8 }),
    deps.conversations.getInsights(key),
    deps.conversations.load(key),
  ]);
  console.log(
    buildSystemPrompt(scope, {
      book,
      profile,
      shelfSize: shelf?.length,
      memories,
      conversationSummary,
      onboardingInterview: scope.kind === "global" && !profile && turns.length === 0,
    }),
  );
}

function printMemories(): void {
  if (!stores.memories.length) {
    console.log("(no memories)");
    return;
  }
  for (const memory of stores.memories) {
    const status = memory.status && memory.status !== "active" ? ` (${memory.status})` : "";
    console.log(
      `- [${memory.scope}] [${memory.kind}] ${memory.content} — importance ${memory.importance.toFixed(2)}, evidence ${memory.evidenceCount}${status}`,
    );
  }
}

const HELP = `commands: :books, :book <id>, :global, :sys, :memories, :turns, :asks, :flush, :consolidate, :quit`;

// ── REPL 主循环 ──

let scope: ThreadScope = { kind: "global" };
console.log(`agent repl — ${provider}/${model}, scope ${threadScopeKey(scope)}`);
console.log(HELP);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
// 管道输入（smoke test）读到 EOF：空闲时立即退出（question 永不 resolve，会挂死）；
// 回合进行中则让当前回合流完再退。
let turnInFlight = false;
let exitAfterTurn = false;
// bun-types 的 promises Interface 类型缺 EventEmitter 面（运行时存在）
(rl as unknown as NodeJS.EventEmitter).on("close", () => {
  if (turnInFlight) exitAfterTurn = true;
  else process.exit(0);
});

for (;;) {
  const line: string = (await rl.question(`\n${threadScopeKey(scope)}> `)).trim();
  if (!line) continue;

  if (line.startsWith(":")) {
    const [command, ...rest] = line.split(/\s+/);
    switch (command) {
      case ":quit":
      case ":q":
        rl.close();
        process.exit(0);
        break;
      case ":books":
        for (const book of BOOKS) console.log(`- ${book.id}  ${book.title}`);
        break;
      case ":book": {
        const id = rest[0];
        if (!BOOKS.some((book) => book.id === id)) {
          console.log(`unknown book id "${id ?? ""}" — try :books`);
          break;
        }
        scope = { kind: "book", bookId: id as Id };
        break;
      }
      case ":global":
        scope = { kind: "global" };
        break;
      case ":sys":
        await printSystemPrompt(scope);
        break;
      case ":memories":
        printMemories();
        break;
      case ":turns":
        for (const [key, list] of stores.turns) console.log(`- ${key}: ${list.length} turns`);
        if (!stores.turns.size) console.log("(no persisted turns)");
        break;
      case ":asks":
        for (const ask of stores.asks) console.log(`- [${ask.anchor ?? "no-anchor"}] ${ask.question}`);
        if (!stores.asks.length) console.log("(no ask-notes)");
        break;
      case ":flush":
        await runtime.flushBackgroundWork();
        console.log("background pipeline drained");
        break;
      case ":consolidate": {
        await runtime.flushBackgroundWork();
        const report = await runtime.consolidate();
        console.log(JSON.stringify(report, null, 2));
        break;
      }
      default:
        console.log(HELP);
        break;
    }
    continue;
  }

  turnInFlight = true;
  try {
    await runTurn(scope, line);
  } catch (error) {
    console.error(`turn failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    turnInFlight = false;
  }
  if (exitAfterTurn) process.exit(0);
}
