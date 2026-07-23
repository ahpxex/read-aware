/**
 * Headless 交互调试台：`bun run repl [provider] [model]`（packages/agent 下）。
 * 不经过任何 UI —— 真书 fixture（fixtures/karamazov.epub，启动时抽取全书正文）
 * + 内存 store + 真模型，逐轮流式打印 thinking / 工具调用（含入参与耗时）/
 * 正文，并提供检查内部状态的命令：
 *
 *   :books              fixture 书架
 *   :book <id>          切到某本书的线程
 *   :global             切到全局线程
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
import { fileURLToPath } from "node:url";
import type { Id } from "@read-aware/core";
import { buildSystemPrompt } from "./context/system-prompt";
import { readPiCliKey } from "./dev-key";
import type { KnownProviderId } from "./models/registry";
import type { AnnotationItem, BookOverview } from "./ports";
import { createAgentRuntime } from "./runtime/runtime";
import { loadEpubFixture } from "./testing/epub-fixture";
import { createInMemoryDeps } from "./testing/fixtures";
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

// ── fixture 世界：真书全文（headless 抽取）+ 从正文派生的标注 ──

const BOOK_ID = "book-karamazov" as Id;
const EPUB_PATH = fileURLToPath(new URL("../fixtures/karamazov.epub", import.meta.url));

const epub = loadEpubFixture(EPUB_PATH);
// Calibre 元数据的书名带一长串营销文案，截到第一个全角括号前
const bookTitle = epub.title.split("【")[0].trim();

const BOOKS: BookOverview[] = [
  { id: BOOK_ID, title: bookTitle, author: epub.author, progressPercent: 35 },
];

/** 从章节正文里取一句 20–80 字的完整句，保证标注与书文本一致（可被全文检索命中）。 */
function pickSentence(chapterIndex: number): { sentence: string; chapter?: string } {
  const chapter = epub.chapters[chapterIndex];
  const sentence = chapter.text
    .split(/(?<=[。！？])/)
    .map((part) => part.trim())
    .find((part) => part.length >= 20 && part.length <= 80);
  return { sentence: sentence ?? chapter.text.slice(0, 60), chapter: chapter.title };
}

const highlightA = pickSentence(Math.floor(epub.chapters.length / 4));
const highlightB = pickSentence(Math.floor(epub.chapters.length / 2));

const ANNOTATIONS: AnnotationItem[] = [
  {
    id: "a1",
    bookId: BOOK_ID,
    kind: "highlight",
    text: highlightA.sentence,
    chapterHref: highlightA.chapter,
    color: "yellow",
    style: "highlight",
    createdAt: "2026-06-20T10:00:00Z",
    updatedAt: "2026-06-20T10:00:00Z",
  },
  {
    id: "a2",
    bookId: BOOK_ID,
    kind: "note",
    quotedText: highlightB.sentence,
    body: "这里的叙述者口吻值得回头再读一遍",
    chapterHref: highlightB.chapter,
    createdAt: "2026-06-22T10:00:00Z",
    updatedAt: "2026-06-22T10:00:00Z",
  },
];

const { deps, stores } = createInMemoryDeps({
  books: BOOKS,
  annotations: ANNOTATIONS,
  chapters: { [BOOK_ID]: epub.chapters },
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
  const turnStartedAt = performance.now();
  // 轮末汇总：往返数 + token 总账
  let rounds = 0;
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  // 当前流的通道：thinking 与 text 交错时负责换行与去/加 dim
  let channel: "idle" | "thinking" | "text" = "idle";
  const switchChannel = (next: "thinking" | "text") => {
    if (channel === next) return;
    if (channel !== "idle") process.stdout.write(`${RESET}\n`);
    if (next === "thinking") process.stdout.write(`${DIM}[thinking] `);
    channel = next;
  };
  const meta = (line: string) => {
    if (channel !== "idle") process.stdout.write(`${RESET}\n`);
    channel = "idle";
    process.stdout.write(`${DIM}${line}${RESET}\n`);
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
          if (chunk.phase === "start") {
            toolStarts.set(chunk.id, performance.now());
            const args = chunk.args === undefined ? "" : ` ${JSON.stringify(chunk.args)}`;
            meta(`[tool] ${chunk.tool}${args}`);
          } else {
            const started = toolStarts.get(chunk.id);
            const elapsed = started === undefined ? "" : ` ${Math.round(performance.now() - started)}ms`;
            meta(`[tool] ${chunk.tool} → ${chunk.isError ? "failed" : "ok"}${elapsed}`);
          }
          break;
        case "metric": {
          rounds = Math.max(rounds, chunk.round);
          if (chunk.tokens) {
            totals.input += chunk.tokens.input;
            totals.output += chunk.tokens.output;
            totals.cacheRead += chunk.tokens.cacheRead;
            totals.cacheWrite += chunk.tokens.cacheWrite;
          }
          const tokens = chunk.tokens
            ? ` · in ${chunk.tokens.input + chunk.tokens.cacheRead}tk (cache ${chunk.tokens.cacheRead}) · out ${chunk.tokens.output}tk`
            : "";
          meta(`[llm] round ${chunk.round} · ttfb ${chunk.ttfbMs}ms · total ${chunk.totalMs}ms${tokens}`);
          break;
        }
        default:
          break;
      }
    }
  } finally {
    if (channel !== "idle") process.stdout.write(`${RESET}\n`);
    const wall = ((performance.now() - turnStartedAt) / 1000).toFixed(1);
    process.stdout.write(
      `${DIM}[turn] ${wall}s · ${rounds} round-trips · in ${totals.input + totals.cacheRead}tk (cache ${totals.cacheRead}) · out ${totals.output}tk${RESET}\n`,
    );
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

// 默认就在真书的线程里 —— repl 的主用途是对着这本书调 agent
let scope: ThreadScope = { kind: "book", bookId: BOOK_ID };
const totalChars = epub.chapters.reduce((sum, chapter) => sum + chapter.text.length, 0);
console.log(
  `agent repl — ${provider}/${model}\nbook: ${bookTitle}（${epub.author ?? "unknown"}）— ${epub.chapters.length} chapters, ${Math.round(totalChars / 10000)}万字`,
);
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
        scope = { kind: "global", threadId: "repl" };
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
