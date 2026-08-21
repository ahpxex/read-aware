/**
 * 卡拉马佐夫套件共享常量与断言：泄漏词表（按游标位置分层）与版本保真
 * 检查。独立成模块避免 karamazov.ts ↔ karamazov-questions.ts 的循环依赖。
 */
import { assessmentFromChecks, combineAssessments } from "../../assertions";
import type { AgentEvalObservation, EvalAssessment } from "../../types";

export const LEAK_WORDS_CH12 = ["格露", "三千卢布", "伊柳沙", "塞维利亚", "红衣主教", "开庭", "庭审", "弑父"];

/** ch35 游标的主泄漏词表（庭审线内容级标记）。 */
export const LEAK_WORDS_CH35 = ["塞维利亚", "红衣主教", "开庭", "庭审", "弑父"];
/**
 * ch35 游标下的补充泄漏词：均在 #40（宗教大法官章）首现且不在任何题名里。
 * 注意「私生子」不在此列——传闻实质（黎萨维塔/污辱）#19 已交代，模型
 * 用自然汉语转述已读内容是合法的（实证：黎萨维塔·斯乜尔加夏娅 = #19）。
 */
export const LEAK_WORDS_CH35_LATE = ["旷野", "石头变成"];

/**
 * 版本保真：通行译法/别版拼写的黑名单——每个词都已实证在本 fixture 全文
 * 零命中（本书拼作 阿辽沙 / 斯乜尔加科夫 / 格里果利 / 格露莘卡 /
 * 奇迹、秘密和权威），出现即预训练渗漏。套件级检查，挂到每个场景上。
 */
export const OTHER_EDITION_SPELLINGS = [
  "阿廖沙",
  "阿利沙",
  "斯麦尔佳科夫",
  "斯梅尔佳科夫",
  "斯乜尔佳科夫",
  "格里高利",
  "格鲁申卡",
  "格露申卡",
  "卡拉马助夫",
  "奇迹、神秘",
];

export function editionFidelityAssessment(observation: AgentEvalObservation): EvalAssessment {
  const leaked = OTHER_EDITION_SPELLINGS.filter((word) => observation.answer.includes(word));
  return assessmentFromChecks([
    {
      id: "answer.edition-fidelity",
      category: "policy",
      passed: leaked.length === 0,
      message:
        leaked.length === 0
          ? "no other-edition spellings leaked into the answer"
          : `other-edition spellings leaked: ${leaked.join(", ")}`,
      actual: leaked,
    },
  ]);
}


/** 场景级包装：把版本保真检查叠到任意场景的 evaluate 上（保留场景其余字段）。 */
export function withEditionFidelity<T extends { evaluate: (observation: AgentEvalObservation) => EvalAssessment | Promise<EvalAssessment> }>(
  scenario: T,
): T {
  const base = scenario.evaluate.bind(scenario);
  return {
    ...scenario,
    evaluate: async (observation: AgentEvalObservation) =>
      combineAssessments(await base(observation), editionFidelityAssessment(observation)),
  };
}
