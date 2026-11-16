/**
 * 叙事性分类器的真书回归：对注册表里每本 fixture 跑一次生产态的
 * classifyBookReadingPolicy（书名/作者 + 目录 + 正文开头样本，fast 档），比对
 * 注册表里的人工标注。分类错一本，围栏与纪要口径就整本走错——这是
 * 分类管线的最小活体测试，跑一次五个调用，秒级。
 *
 *   bun run eval:classify [--provider p] [--model m]   # 缺省同 eval runner：DeepSeek 官方 deepseek-flash
 */
import { classifyBookReadingPolicy } from "./memory/narrativity";
import { accountCredential, createModelResolver } from "./models/accounts";
import { createCompleteFn } from "./models/complete";
import { evalProviderRegistry } from "./evals/model-config";
import type { ChapterRef } from "./ports";
import { realBook, realBookSlugs } from "./evals/book-fixtures";
import { applyEvalRouting, EVAL_DEFAULT_PROVIDER, resolveEvalModel } from "./evals/model-config";

import { EvalArtifactStore } from "./evals/artifacts";
import { runEvalSuite } from "./evals/runner";
import { assessmentFromChecks } from "./evals/assertions";
import { formatEvalReport, formatRunLine } from "./evals/report";
import { qualitySummaryText } from "./evals/reviews";
import { toJsonValue } from "./evals/json";
import { GLOBAL_QUALITY_RUBRIC } from "./evals/rubric";
import type { EvalScenario } from "./evals/types";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const provider = argValue("--provider") ?? EVAL_DEFAULT_PROVIDER;
const registry = evalProviderRegistry();
const resolved = resolveEvalModel(registry, provider, argValue("--model"));
const complete = createCompleteFn(registry, resolved.account, "off");
const model = createModelResolver(
  resolved.account,
  { smart: resolved.modelId, fast: resolved.modelId },
  registry,
)("fast");
const routedModel = applyEvalRouting(model);

type Policy = Awaited<ReturnType<typeof classifyBookReadingPolicy>>;
type Observation = {
  policy: Policy;
  answer: string;
  turns: Array<{ input: { text: string }; answer: string }>;
  reviewEvidence: unknown;
};
const scenarios = realBookSlugs().map((slug) => {
  const book = realBook(slug);
  const epub = book.epub();
  const toc: ChapterRef[] = epub.chapters.map((chapter, index) => ({
    index,
    title: chapter.title,
    chars: chapter.text.length,
  }));
  const source = {
    title: book.title(),
    author: epub.author,
    toc,
    sampleText: epub.chapters[book.spec.firstContentChapter]?.text ?? "",
  };
  return {
    id: slug,
    description: `Reading policy classification for ${book.title()}`,
    input: toJsonValue({
      source,
      expected: { narrativity: book.spec.narrativity, spoilerSensitive: book.spec.spoilerSensitive },
      rubric: [
        ...GLOBAL_QUALITY_RUBRIC,
        "Judge the book's actual form and spoiler sensitivity from its title, TOC and source sample; explain any conflict with the registry label.",
      ],
    }),
    source,
    evaluate: ({ policy }: Observation) =>
      assessmentFromChecks([
        {
          id: "registry.policy-match",
          category: "policy",
          passed:
            policy?.narrativity === book.spec.narrativity && policy.spoilerSensitive === book.spec.spoilerSensitive,
          message: "Comparison to the fixture registry (diagnostic; inspect source and classification rationale)",
          expected: toJsonValue({ narrativity: book.spec.narrativity, spoilerSensitive: book.spec.spoilerSensitive }),
          actual: toJsonValue(policy),
        },
      ]),
  } satisfies EvalScenario<Observation> & { source: typeof source };
});
const artifacts = await EvalArtifactStore.create({
  suiteId: "classify",
  secrets: [accountCredential(resolved.account)],
});
const result = await runEvalSuite<Observation, (typeof scenarios)[number]>(
  {
    id: "classify",
    code: "CLASSIFY",
    displayName: "阅读策略分类器",
    description: "Original-source policy classification review",
    scenarios,
  },
  [
    {
      id: "baseline",
      metadata: { provider, model: resolved.modelId, thinkingLevel: "off" },
      run: async (scenario) => {
        const policy = await classifyBookReadingPolicy({ complete, model: routedModel, ...scenario.source });
        const answer = policy ? JSON.stringify(policy) : "No confident policy returned.";
        return {
          observation: {
            policy,
            answer,
            turns: [{ input: { text: `Classify the reading policy of ${scenario.source.title}` }, answer }],
            reviewEvidence: scenario.source,
          },
        };
      },
    },
  ],
  {
    hooks: {
      onPlan: (plan) => artifacts.writePlan(plan),
      onRunComplete: async (record) => {
        console.log(formatRunLine(record));
        await artifacts.writeRun(record);
      },
    },
  },
);
await artifacts.writeSummary(result.summary, formatEvalReport(result.summary));
console.log(`Quality: ${qualitySummaryText(result.summary.quality!)}`);
console.log(
  `Artifacts: ${artifacts.directory}; review source and output, then bun run eval:review ${artifacts.directory} --gate`,
);
if (result.summary.errors > 0 || (process.argv.includes("--gate") && result.summary.quality!.pending > 0))
  process.exitCode = 1;
