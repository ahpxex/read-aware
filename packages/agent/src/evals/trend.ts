/**
 * 跨 run 的基线趋势：每个套件在 .eval/trend-<suite>.json 里存上一次
 * baseline 变体的按场景通过率/均分，跑完自动 diff——劣化不再靠人肉对表。
 * 单文件只存最近一次；bundle 本身就是完整历史。
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EvalSummary } from "./types";

export interface TrendScenarioEntry {
  scenarioId: string;
  passRate: number;
  meanScore: number;
  runs: number;
}

export interface SuiteTrend {
  suiteId: string;
  baselineVariantId: string;
  model: string;
  generatedAt: string;
  scenarios: TrendScenarioEntry[];
}

export function trendFromSummary(summary: EvalSummary, model: string): SuiteTrend {
  return {
    suiteId: summary.suiteId,
    baselineVariantId: summary.baselineVariantId,
    model,
    generatedAt: summary.generatedAt,
    scenarios: summary.byScenario
      .filter((entry) => entry.variantId === summary.baselineVariantId && entry.scenarioId)
      .map((entry) => ({
        scenarioId: entry.scenarioId!,
        passRate: entry.passRate,
        meanScore: entry.meanScore,
        runs: entry.runs,
      })),
  };
}

/** 与上一次的按场景对比；只报有变化的行，劣化行以 "!" 前缀标出。 */
export function compareTrends(previous: SuiteTrend, current: SuiteTrend): string[] {
  const lines: string[] = [];
  if (previous.model !== current.model) {
    lines.push(`note: baseline model changed (${previous.model} -> ${current.model})`);
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
