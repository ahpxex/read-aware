/**
 * Live reading-behavior evaluation:
 *   bun run eval:reading [provider=deepseek] [model]
 *   bun run eval:reading custom [model]
 *
 * Known providers read their normal *_API_KEY or pi CLI auth. Custom mode reads
 * READAWARE_EVAL_BASE_URL / READAWARE_EVAL_API_KEY and optionally
 * READAWARE_EVAL_API=openai-completions|openai-responses.
 */
import type { Api, AssistantMessage, Model, Usage } from "@earendil-works/pi-ai";
import type { Id } from "@read-aware/core";
import type { ThreadChunk } from "./chunks";
import { readPiCliKey } from "./dev-key";
import { evaluateReadingBehavior, type ReadingBehaviorExpectation } from "./evals/reading-behavior";
import { createModelResolver, type LlmAccount } from "./models/accounts";
import { createStreamFn, type CompleteFn } from "./models/complete";
import { isCustomOpenAIApi } from "./models/custom-openai";
import {
  buildProviderRegistry,
  KNOWN_PROVIDERS,
  type KnownProviderId,
} from "./models/registry";
import type { BookOverview } from "./ports";
import { AgentThread, type SendTurnInput } from "./runtime/thread";
import { createInMemoryDeps, type ChapterSeed } from "./testing/fixtures";

type Scenario = {
  id: string;
  book: BookOverview;
  chapters: ChapterSeed[];
  turn: SendTurnInput;
  expectation: ReadingBehaviorExpectation;
};

const NARRATIVE_BOOK_ID = "eval-locked-room" as Id;
const narrativeBook: BookOverview = {
  id: NARRATIVE_BOOK_ID,
  title: "The Locked Room: A Novel",
  author: "Mira Vale",
  progressPercent: 18,
  status: "reading",
};
const narrativeChapters: ChapterSeed[] = [
  {
    title: "Wet Footprints",
    hrefs: ["chapter-1.xhtml"],
    text: "Victor is found dead in a locked study. Mara notices wet footprints, a stopped brass clock, and an unopened letter. Nobody has yet been accused. Later that night, beyond the reader's current position, Mara secretly finds Rowan's silver key beneath the study window.",
  },
  {
    title: "The Confession",
    hrefs: ["chapter-2.xhtml"],
    text: "In the final confession, the detective proves that Rowan killed Victor and staged the locked room with a hidden wire.",
  },
];

const scenarios: Scenario[] = [
  {
    id: "narrative-no-spoiler",
    book: narrativeBook,
    chapters: narrativeChapters,
    turn: {
      text: "Based only on what I have read so far, help me reason about the clues without spoiling who killed Victor.",
      readingCursor: {
        chapter: "chapter-1.xhtml",
        chapterTitle: "Wet Footprints",
        bookProgress: 0.18,
        chapterProgress: 0.55,
        visibleText:
          "Victor is found dead in a locked study. Mara notices wet footprints and a stopped brass clock. Nobody has yet been accused.",
      },
    },
    expectation: {
      mustNotContain: ["Rowan", "silver key", "hidden wire", "final confession"],
      forbiddenTools: ["read_chapter", "search_book_text"],
    },
  },
  {
    id: "explicit-spoiler",
    book: narrativeBook,
    chapters: narrativeChapters,
    turn: {
      text: "Spoil the novel for me: who killed Victor, and how was the locked room staged?",
      readingCursor: {
        chapter: "chapter-1.xhtml",
        chapterTitle: "Wet Footprints",
        bookProgress: 0.18,
        chapterProgress: 0.55,
        visibleText: "Victor is found dead in a locked study.",
      },
    },
    expectation: {
      mustContain: ["Rowan", "wire"],
      requiredAnyTool: ["read_chapter", "search_book_text"],
    },
  },
  {
    id: "cursor-grounding",
    book: narrativeBook,
    chapters: narrativeChapters,
    turn: {
      text: "What precise clock detail is on the page I am looking at?",
      readingCursor: {
        chapter: "chapter-1.xhtml",
        chapterTitle: "Wet Footprints",
        chapterProgress: 0.55,
        visibleText: "The brass clock stopped at seventeen minutes past nine.",
      },
    },
    expectation: { mustContain: ["seventeen", "nine"] },
  },
  {
    id: "expository-can-look-ahead",
    book: {
      id: "eval-data-structures" as Id,
      title: "Practical Data Structures",
      author: "A. N. Author",
      progressPercent: 20,
      status: "reading",
    },
    chapters: [
      {
        title: "Arrays",
        hrefs: ["arrays.xhtml"],
        text: "Arrays store elements in contiguous memory and offer constant-time indexed access.",
      },
      {
        title: "Balanced Trees",
        hrefs: ["trees.xhtml"],
        text: "This chapter implements red-black trees and explains rotations, recoloring, and logarithmic lookup.",
      },
    ],
    turn: {
      text: "Does this book later cover red-black trees? Check the actual book before answering.",
      readingCursor: {
        chapter: "arrays.xhtml",
        chapterTitle: "Arrays",
        bookProgress: 0.2,
        chapterProgress: 0.7,
        visibleText: "Arrays store elements in contiguous memory.",
      },
    },
    expectation: {
      mustContain: ["red-black"],
      requiredAnyTool: ["read_chapter", "search_book_text"],
    },
  },
];

const envKeys: Record<KnownProviderId, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  zai: "ZAI_API_KEY",
  "zai-coding-cn": "ZAI_CODING_CN_API_KEY",
  google: "GOOGLE_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  xai: "XAI_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  moonshotai: "MOONSHOTAI_API_KEY",
};

function resolveAccount(registry: ReturnType<typeof buildProviderRegistry>): {
  account: LlmAccount;
  modelId: string;
} {
  const providerArg = process.argv[2] ?? "deepseek";
  const requestedModel = process.argv[3];
  if (providerArg === "custom") {
    const baseUrl = process.env.READAWARE_EVAL_BASE_URL?.trim() ?? "";
    const apiKey = process.env.READAWARE_EVAL_API_KEY?.trim() ?? "";
    const modelId = requestedModel ?? process.env.READAWARE_EVAL_MODEL?.trim() ?? "";
    const rawApi = process.env.READAWARE_EVAL_API ?? "openai-completions";
    if (!baseUrl || !apiKey || !modelId || !isCustomOpenAIApi(rawApi)) {
      throw new Error(
        "custom eval requires READAWARE_EVAL_BASE_URL, READAWARE_EVAL_API_KEY, a model, and a valid READAWARE_EVAL_API",
      );
    }
    return {
      account: {
        kind: "api-key",
        provider: "custom-openai",
        apiKey,
        baseUrl,
        api: rawApi,
        supportsThinking: process.env.READAWARE_EVAL_THINKING !== "off",
      },
      modelId,
    };
  }
  if (!KNOWN_PROVIDERS.includes(providerArg as KnownProviderId)) {
    throw new Error(`unknown provider ${JSON.stringify(providerArg)}`);
  }
  const provider = providerArg as KnownProviderId;
  const apiKey = process.env[envKeys[provider]] ?? readPiCliKey(provider) ?? "";
  if (!apiKey) throw new Error(`no API key: set ${envKeys[provider]} or configure pi CLI auth`);
  const catalog = registry.getModels(provider);
  const modelId = requestedModel ?? catalog.find((model) => model.reasoning)?.id ?? catalog[0]?.id;
  if (!modelId) throw new Error(`provider ${provider} has no registered model`);
  return { account: { kind: "api-key", provider, apiKey }, modelId };
}

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function noMemoryComplete(model: Model<Api>): Promise<AssistantMessage> {
  return Promise.resolve({
    role: "assistant",
    content: [{ type: "text", text: '{"new": [], "reinforced": []}' }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  });
}

const registry = buildProviderRegistry();
const { account, modelId } = resolveAccount(registry);
const resolveModel = createModelResolver(account, { smart: modelId, fast: modelId }, registry);
const streamFn = createStreamFn(registry, account, "medium");
const completeFn: CompleteFn = (model) => noMemoryComplete(model);
let failed = false;
const scenarioFilter = process.env.READAWARE_EVAL_SCENARIO?.trim();
const selectedScenarios = scenarioFilter
  ? scenarios.filter((scenario) => scenario.id === scenarioFilter)
  : scenarios;
if (selectedScenarios.length === 0) {
  throw new Error(`unknown READAWARE_EVAL_SCENARIO ${JSON.stringify(scenarioFilter)}`);
}

console.log(`Reading behavior eval: ${account.provider}/${modelId}`);
for (const scenario of selectedScenarios) {
  const { deps } = createInMemoryDeps({
    books: [scenario.book],
    chapters: { [scenario.book.id]: scenario.chapters },
  });
  const thread = new AgentThread({
    scope: { kind: "book", bookId: scenario.book.id },
    deps,
    resolveModel,
    getApiKey: () => account.apiKey,
    completeFn,
    streamFn,
    thinkingLevel: "medium",
  });
  const chunks: ThreadChunk[] = [];
  for await (const chunk of thread.sendTurn(scenario.turn)) chunks.push(chunk);
  await thread.flushBackgroundWork();
  const result = evaluateReadingBehavior(chunks, scenario.expectation);
  const status = result.failures.length === 0 ? "PASS" : "FAIL";
  console.log(`\n[${status}] ${scenario.id}`);
  console.log(
    `tools: ${result.tools
      .map((tool) => `${tool.name}${tool.isError ? " (failed)" : ""} ${JSON.stringify(tool.args ?? {})}`)
      .join(", ") || "none"}`,
  );
  console.log(result.answer.trim());
  if (result.failures.length > 0) {
    for (const tool of result.tools) {
      if (tool.output) console.log(`  ${tool.name} -> ${tool.output.slice(0, 600)}`);
    }
  }
  for (const failure of result.failures) console.log(`  - ${failure}`);
  failed ||= result.failures.length > 0;
}

if (failed) process.exitCode = 1;
