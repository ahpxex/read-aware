/**
 * 行为套件组：合成 fixture（或以真书为道具的横切行为）上的**能力**测试。
 * 组的身份轴是"测什么能力"，不是"用什么书"——真书专属套件在 realbook/。
 * 组内顺序 = 推荐阅读/运行顺序：先单书核心能力（阅读/记忆），再交互与
 * 呈现，最后是跨书与历史包袱的复合场景。
 */
import { annotationsEvalSuite } from "./annotations";
import { crossbookEvalSuite } from "./crossbook";
import { groundingEvalSuite } from "./grounding";
import { interactionsEvalSuite } from "./interactions";
import { journeysEvalSuite } from "./journeys";
import { legacyEvalSuite } from "./legacy";
import { memoryEvalSuite } from "./memory";
import { personalizationEvalSuite } from "./personalization";
import { readingEvalSuite } from "./reading";
import { settingsEvalSuite } from "./settings";
import { toolsEvalSuite } from "./tools";

export const behaviorSuites = {
  reading: readingEvalSuite,
  grounding: groundingEvalSuite,
  memory: memoryEvalSuite,
  personalization: personalizationEvalSuite,
  annotations: annotationsEvalSuite,
  interactions: interactionsEvalSuite,
  settings: settingsEvalSuite,
  tools: toolsEvalSuite,
  crossbook: crossbookEvalSuite,
  journeys: journeysEvalSuite,
  legacy: legacyEvalSuite,
} as const;

export type BehaviorSuiteId = keyof typeof behaviorSuites;
