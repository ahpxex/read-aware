import { annotationsEvalSuite } from "./annotations";
import { bergerEvalSuite } from "./berger";
import { crossbookEvalSuite } from "./crossbook";
import { groundingEvalSuite } from "./grounding";
import { interactionsEvalSuite } from "./interactions";
import { karamazovEvalSuite } from "./karamazov";
import { lebonEvalSuite } from "./lebon";
import { memoryEvalSuite } from "./memory";
import { readingEvalSuite } from "./reading";
import { realBooksEvalSuite } from "./real-book-common";
import { refactoringEvalSuite } from "./refactoring";
import { santiEvalSuite } from "./santi";
import { settingsEvalSuite } from "./settings";
import { toolsEvalSuite } from "./tools";

export const evalSuites = {
  annotations: annotationsEvalSuite,
  berger: bergerEvalSuite,
  crossbook: crossbookEvalSuite,
  grounding: groundingEvalSuite,
  interactions: interactionsEvalSuite,
  karamazov: karamazovEvalSuite,
  lebon: lebonEvalSuite,
  memory: memoryEvalSuite,
  reading: readingEvalSuite,
  realbooks: realBooksEvalSuite,
  refactoring: refactoringEvalSuite,
  santi: santiEvalSuite,
  settings: settingsEvalSuite,
  tools: toolsEvalSuite,
} as const;

export type EvalSuiteId = keyof typeof evalSuites;

export function isEvalSuiteId(value: string): value is EvalSuiteId {
  return Object.prototype.hasOwnProperty.call(evalSuites, value);
}
