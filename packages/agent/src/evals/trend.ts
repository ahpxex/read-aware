/**
 * 跨 run 的基线趋势：每个套件在 .eval/trend-<suite>.json 里存上一次
 * baseline 变体的按场景通过率/均分，跑完自动 diff——劣化不再靠人肉对表。
 * 单文件只存最近一次；bundle 本身就是完整历史。
 * 场景条目携带能力标签，另存 byTag 汇总：能力维度的劣化一眼可见。
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EvalSummary } from "./types";

export interface TrendScenarioEntry {
  scenarioId: string;
  passRate: number;
  meanScore: number;
  runs: number;
  /** 场景的能力/形态标签（词汇表见 evals/tags.ts）。 */
  tags?: string[];
}

export interface TrendTagEntry {
  tag: string;
  passRate: number;
  meanScore: number;
  runs: number;
}

export interface SuiteTrend {
  suiteId: string;
  /** Scoring contract; differing hashes must never produce regression deltas. */
  definitionHash?: string;
  baselineVariantId: string;
  model: string;
  /** 解码配置（thinking 档位）。缺失 = 记录该字段之前的旧 trend。 */
  thinkingLevel?: string;
  generatedAt: string;
  scenarios: TrendScenarioEntry[];
  /** 能力标签汇总（baseline 变体）。缺失 = 旧 trend 未记录。 */
  byTag?: TrendTagEntry[];
}

export function trendFromSummary(
  summary: EvalSummary,
  model: string,
  thinkingLevel?: string,
  tagsByScenario?: ReadonlyMap<string, readonly string[]>,
): SuiteTrend {
  const baseline = summary.byScenario.filter(
    (entry) => entry.variantId === summary.baselineVariantId && entry.scenarioId,
  );
  const tagsOf = (scenarioId: string) => tagsByScenario?.get(scenarioId) ?? [];
  return {
    suiteId: summary.suiteId,
    ...(summary.definitionHash ? { definitionHash: summary.definitionHash } : {}),
    baselineVariantId: summary.baselineVariantId,
    model,
    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
    generatedAt: summary.generatedAt,
    scenarios: baseline.map((entry) => ({
      scenarioId: entry.scenarioId!,
      passRate: entry.passRate,
      meanScore: entry.meanScore,
      runs: entry.runs,
      ...(tagsOf(entry.scenarioId!).length
        ? { tags: [...tagsOf(entry.scenarioId!)] }
        : {}),
    })),
    byTag: summary.byTag
      .filter((entry) => entry.variantId === summary.baselineVariantId && entry.tag)
      .map((entry) => ({
        tag: entry.tag!,
        passRate: entry.passRate,
        meanScore: entry.meanScore,
        runs: entry.runs,
      })),
  };
}

/** 与上一次的按场景对比；只报有变化的行，劣化行以 "!" 前缀标出。 */
export function compareTrends(previous: SuiteTrend, current: SuiteTrend): string[] {
  const lines: string[] = [];
  if (
    previous.definitionHash !== undefined &&
    current.definitionHash !== undefined &&
    previous.definitionHash !== current.definitionHash
  ) {
    return [
      `note: INCOMPARABLE — eval definition changed (${previous.definitionHash} -> ${current.definitionHash}); scenario and tag deltas are suppressed`,
    ];
  }
  if (previous.model !== current.model) {
    lines.push(`note: baseline model changed (${previous.model} -> ${current.model})`);
  }
  // 解码配置不同的两次 run 不构成有效对照：thinking 档位直接改变工具
  // 纪律与措辞，逐场景 delta 会把解码差异误读成行为回归。
  if ((previous.thinkingLevel ?? "unrecorded") !== (current.thinkingLevel ?? "unrecorded")) {
    lines.push(
      `note: INCOMPARABLE — thinking level changed (${previous.thinkingLevel ?? "unrecorded"} -> ${current.thinkingLevel ?? "unrecorded"}); per-scenario deltas below mix decoding and behavior changes`,
    );
  }
  const before = new Map(previous.scenarios.map((entry) => [entry.scenarioId, entry]));
  for (const entry of current.scenarios) {
    const prior = before.get(entry.scenarioId);
    if (!prior) {
      lines.push(`  new scenario ${entry.scenarioId}: pass ${(entry.passRate * 100).toFixed(0)}%`);
      continue;
    }
    const passDelta = entry.passRate - prior.passRate;
    const scoreDelta = entry.meanScore - prior.meanScore;
    if (Math.abs(passDelta) < 1e-9 && Math.abs(scoreDelta) < 0.005) continue;
    const marker = passDelta < 0 || (passDelta === 0 && scoreDelta < 0) ? "!" : " ";
    lines.push(
      `${marker} ${entry.scenarioId}: pass ${(prior.passRate * 100).toFixed(0)}% -> ${(entry.passRate * 100).toFixed(0)}%, score ${prior.meanScore.toFixed(2)} -> ${entry.meanScore.toFixed(2)}`,
    );
  }
  for (const entry of previous.scenarios) {
    if (!current.scenarios.some((candidate) => candidate.scenarioId === entry.scenarioId)) {
      lines.push(`  removed scenario ${entry.scenarioId}`);
    }
  }
  // 能力标签汇总的变化：单场景的抖动看不出来、一类能力整体劣化才是回归
  const previousTags = new Map((previous.byTag ?? []).map((entry) => [entry.tag, entry]));
  const currentTags = new Map((current.byTag ?? []).map((entry) => [entry.tag, entry]));
  const tagLines: string[] = [];
  for (const entry of currentTags.values()) {
    const prior = previousTags.get(entry.tag);
    if (!prior) continue;
    const passDelta = entry.passRate - prior.passRate;
    const scoreDelta = entry.meanScore - prior.meanScore;
    if (Math.abs(passDelta) < 1e-9 && Math.abs(scoreDelta) < 0.005) continue;
    const marker = passDelta < 0 || (passDelta === 0 && scoreDelta < 0) ? "!" : " ";
    tagLines.push(
      `${marker} tag ${entry.tag}: pass ${(prior.passRate * 100).toFixed(0)}% -> ${(entry.passRate * 100).toFixed(0)}%, score ${prior.meanScore.toFixed(2)} -> ${entry.meanScore.toFixed(2)}`,
    );
  }
  if (tagLines.length > 0) lines.push("Tag rollup vs previous run:", ...tagLines);
  return lines;
}

export function trendPath(rootDir: string, suiteId: string): string {
  return join(rootDir, `trend-${suiteId}.json`);
}

export async function loadTrend(path: string): Promise<SuiteTrend | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as SuiteTrend;
  } catch {
    return undefined;
  }
}

export async function saveTrend(path: string, trend: SuiteTrend): Promise<void> {
  await writeFile(path, `${JSON.stringify(trend, null, 2)}\n`, "utf8");
}
