import { interactionsEvalSuite } from "./interactions";
import { memoryEvalSuite } from "./memory";
import { readingEvalSuite } from "./reading";
import { settingsEvalSuite } from "./settings";
import { toolsEvalSuite } from "./tools";

export const evalSuites = {
  interactions: interactionsEvalSuite,
  memory: memoryEvalSuite,
  reading: readingEvalSuite,
  settings: settingsEvalSuite,
  tools: toolsEvalSuite,
} as const;

export type EvalSuiteId = keyof typeof evalSuites;

export function isEvalSuiteId(value: string): value is EvalSuiteId {
  return Object.prototype.hasOwnProperty.call(evalSuites, value);
}
