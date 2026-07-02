/**
 * Onboarding 的 runtime 侧（doc §9）：
 * - applyOnboarding()：结构化快选的落库 —— 写画像摘要 + 播种 user scope 记忆。
 *   UI（产品或 lab）只负责收集答案。
 * - 访谈部分不需要专门机制：全局线程首次使用且画像为空时，system prompt
 *   进入访谈模式（见 context/system-prompt.ts），回答由提炼管道转成种子记忆。
 * Onboarding 只是种子，不是画像的真相来源 —— 之后靠渐进式画像持续更新。
 */
import type { NewMemoryInput, RuntimeDeps } from "./ports";

export interface OnboardingAnswers {
  /** 阅读目标，如"系统学习经济史" */
  goals?: string;
  /** 领域背景/认知结构，如"工程背景，人文薄弱" */
  background?: string;
  /** 偏好的讲解深度，如"第一性原理、别怕长" */
  explanationDepth?: string;
  /** 回复语言偏好 */
  language?: string;
}

export function buildProfileSummary(answers: OnboardingAnswers): string {
  const parts: string[] = [];
  if (answers.background) parts.push(`背景：${answers.background}`);
  if (answers.goals) parts.push(`阅读目标：${answers.goals}`);
  if (answers.explanationDepth) parts.push(`讲解偏好：${answers.explanationDepth}`);
  if (answers.language) parts.push(`语言：${answers.language}`);
  return parts.join("\n");
}

export async function applyOnboarding(
  deps: Pick<RuntimeDeps, "profile" | "memory">,
  answers: OnboardingAnswers,
): Promise<void> {
  const summary = buildProfileSummary(answers);
  if (summary) await deps.profile.putProfileSummary(summary);

  const seeds: Array<Pick<NewMemoryInput, "kind" | "content">> = [];
  if (answers.goals) seeds.push({ kind: "preference", content: `阅读目标：${answers.goals}` });
  if (answers.explanationDepth) {
    seeds.push({ kind: "preference", content: `讲解偏好：${answers.explanationDepth}` });
  }
  if (answers.background) seeds.push({ kind: "fact", content: `读者背景：${answers.background}` });
  for (const seed of seeds) {
    await deps.memory.saveMemory({
      ...seed,
      scope: "user",
      origin: "onboarding",
      sourceThreadKey: "global",
    });
  }
}
