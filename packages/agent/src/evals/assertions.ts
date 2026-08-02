import type {
  AgentEvalObservation,
  EvalAssessment,
  EvalCheck,
  EvalCheckCategory,
  JsonValue,
} from "./types";

export interface AgentTraceExpectation {
  answer?: {
    mustContain?: string[];
    mustNotContain?: string[];
  };
  tools?: {
    required?: string[];
    requiredAny?: string[];
    forbidden?: string[];
    exactSequence?: string[];
    noErrors?: boolean;
    maxCalls?: number;
  };
  interactions?: {
    requiredKinds?: Array<"question" | "permission">;
    forbiddenKinds?: Array<"question" | "permission">;
  };
  maxRounds?: number;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

function check(
  id: string,
  category: EvalCheckCategory,
  passed: boolean,
  message: string,
  expected?: JsonValue,
  actual?: JsonValue,
): EvalCheck {
  return { id, category, passed, message, expected, actual };
}

export function assessmentFromChecks(checks: EvalCheck[]): EvalAssessment {
  const totalWeight = checks.reduce((total, entry) => total + (entry.weight ?? 1), 0);
  const passedWeight = checks.reduce(
    (total, entry) => total + (entry.passed ? (entry.weight ?? 1) : 0),
    0,
  );
  return {
    passed: checks.every((entry) => entry.passed),
    score: totalWeight === 0 ? 1 : passedWeight / totalWeight,
    checks,
  };
}

export function combineAssessments(...assessments: EvalAssessment[]): EvalAssessment {
  return assessmentFromChecks(assessments.flatMap((assessment) => assessment.checks));
}

export function evaluateAgentTrace(
  observation: AgentEvalObservation,
  expectation: AgentTraceExpectation,
): EvalAssessment {
  const checks: EvalCheck[] = [];
  const answer = normalize(observation.answer);
  const toolNames = observation.tools.map((tool) => tool.name);
  const interactionKinds = observation.interactions
    .filter((interaction) => interaction.phase === "request")
    .flatMap((interaction) => (interaction.kind ? [interaction.kind] : []));

  for (const [index, phrase] of (expectation.answer?.mustContain ?? []).entries()) {
    const passed = answer.includes(normalize(phrase));
    checks.push(
      check(
        `answer.contains.${index}`,
        "answer",
        passed,
        passed
          ? `answer contains ${JSON.stringify(phrase)}`
          : `answer did not contain required phrase ${JSON.stringify(phrase)}`,
        phrase,
      ),
    );
  }

  for (const [index, phrase] of (expectation.answer?.mustNotContain ?? []).entries()) {
    const passed = !answer.includes(normalize(phrase));
    checks.push(
      check(
        `answer.excludes.${index}`,
        "policy",
        passed,
        passed
          ? `answer excludes ${JSON.stringify(phrase)}`
          : `answer contained forbidden phrase ${JSON.stringify(phrase)}`,
        phrase,
      ),
    );
  }

  for (const name of expectation.tools?.required ?? []) {
    const passed = toolNames.includes(name);
    checks.push(
      check(
        `tool.required.${name}`,
        "tool",
        passed,
        passed ? `required tool ${name} ran` : `required tool ${name} did not run`,
        name,
        toolNames,
      ),
    );
  }

  const requiredAny = expectation.tools?.requiredAny ?? [];
  if (requiredAny.length > 0) {
    const passed = requiredAny.some((name) => toolNames.includes(name));
    checks.push(
      check(
        "tool.required-any",
        "tool",
        passed,
        passed
          ? "at least one permitted retrieval tool ran"
          : `none of the required tools ran: ${requiredAny.join(", ")}`,
        requiredAny,
        toolNames,
      ),
    );
  }

  for (const name of expectation.tools?.forbidden ?? []) {
    const passed = !toolNames.includes(name);
    checks.push(
      check(
        `tool.forbidden.${name}`,
        "policy",
        passed,
        passed ? `forbidden tool ${name} did not run` : `forbidden tool ${name} ran`,
        name,
        toolNames,
      ),
    );
  }

  if (expectation.tools?.exactSequence) {
    const expected = expectation.tools.exactSequence;
    const passed =
      expected.length === toolNames.length &&
      expected.every((name, index) => name === toolNames[index]);
    checks.push(
      check(
        "tool.exact-sequence",
        "tool",
        passed,
        passed ? "tool sequence matched" : "tool sequence did not match",
        expected,
        toolNames,
      ),
    );
  }

  if (expectation.tools?.noErrors) {
    const failedTools = observation.tools.filter((tool) => tool.isError).map((tool) => tool.name);
    checks.push(
      check(
        "tool.no-errors",
        "tool",
        failedTools.length === 0,
        failedTools.length === 0
          ? "all tool calls succeeded"
          : `tool calls failed: ${failedTools.join(", ")}`,
        [],
        failedTools,
      ),
    );
  }

  if (expectation.tools?.maxCalls !== undefined) {
    const passed = observation.tools.length <= expectation.tools.maxCalls;
    checks.push(
      check(
        "tool.max-calls",
        "quality",
        passed,
        passed
          ? `tool calls stayed within ${expectation.tools.maxCalls}`
          : `tool calls exceeded ${expectation.tools.maxCalls}`,
        expectation.tools.maxCalls,
        observation.tools.length,
      ),
    );
  }

  for (const kind of expectation.interactions?.requiredKinds ?? []) {
    const passed = interactionKinds.includes(kind);
    checks.push(
      check(
        `interaction.required.${kind}`,
        "interaction",
        passed,
        passed ? `${kind} interaction was requested` : `${kind} interaction was not requested`,
        kind,
        interactionKinds,
      ),
    );
  }

  for (const kind of expectation.interactions?.forbiddenKinds ?? []) {
    const passed = !interactionKinds.includes(kind);
    checks.push(
      check(
        `interaction.forbidden.${kind}`,
        "policy",
        passed,
        passed ? `${kind} interaction was not requested` : `${kind} interaction was requested`,
        kind,
        interactionKinds,
      ),
    );
  }

  if (expectation.maxRounds !== undefined) {
    const rounds = observation.telemetry.rounds ?? 0;
    const passed = rounds <= expectation.maxRounds;
    checks.push(
      check(
        "quality.max-rounds",
        "quality",
        passed,
        passed
          ? `model rounds stayed within ${expectation.maxRounds}`
          : `model rounds exceeded ${expectation.maxRounds}`,
        expectation.maxRounds,
        rounds,
      ),
    );
  }

  return assessmentFromChecks(checks);
}
