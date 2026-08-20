import { annotationsEvalSuite } from "./annotations";
import { groundingEvalSuite } from "./grounding";
import { interactionsEvalSuite } from "./interactions";
import { karamazovEvalSuite } from "./karamazov";
import { lebonEvalSuite } from "./lebon";
import { memoryEvalSuite } from "./memory";
import { readingEvalSuite } from "./reading";
import { santiEvalSuite } from "./santi";
import { settingsEvalSuite } from "./settings";
import { toolsEvalSuite } from "./tools";

export const evalSuites = {
  annotations: annotationsEvalSuite,
  grounding: groundingEvalSuite,
  interactions: interactionsEvalSuite,
  karamazov: karamazovEvalSuite,
  lebon: lebonEvalSuite,
  memory: memoryEvalSuite,
  reading: readingEvalSuite,
  santi: santiEvalSuite,
  settings: settingsEvalSuite,
  tools: toolsEvalSuite,
} as const;

export type EvalSuiteId = keyof typeof evalSuites;

export function isEvalSuiteId(value: string): value is EvalSuiteId {
  return Object.prototype.hasOwnProperty.call(evalSuites, value);
}
