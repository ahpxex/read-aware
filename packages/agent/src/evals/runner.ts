import { toJsonValue } from "./json";
import { buildEvalSummary } from "./summary";
import {
  EvalStageError,
  type EvalErrorStage,
  type EvalHarnessOutput,
  type EvalRunHooks,
  type EvalRunPlan,
  type EvalRunRecord,
  type EvalScenario,
  type EvalSuite,
  type EvalSummary,
  type EvalVariant,
} from "./types";

export interface RunEvalSuiteOptions {
  repetitions?: number;
  timeoutMs?: number;
  /**
   * 并发的 (repetition, scenario) 单元数（默认 1 = 全串行）。
   * 单元内部各 variant 仍按轮转顺序串行执行，配对比较不受影响。
   */
  concurrency?: number;
  hooks?: EvalRunHooks;
}

export interface RunEvalSuiteResult {
  plan: EvalRunPlan;
  records: EvalRunRecord[];
  summary: EvalSummary;
}

class EvalTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`evaluation timed out after ${timeoutMs}ms`);
    this.name = "EvalTimeoutError";
  }
}

const timeoutMarker = Symbol("eval-timeout");

function errorDetails(error: unknown, stage: EvalErrorStage) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const cause = normalized instanceof EvalStageError ? normalized.cause : undefined;
  const causeMessage = cause instanceof Error ? `: ${cause.message}` : "";
  return {
    stage,
    name: normalized.name,
    message: `${normalized.message}${causeMessage}`,
    ...(normalized.stack ? { stack: normalized.stack } : {}),
    ...(cause instanceof Error
      ? {
          cause: {
            name: cause.name,
            message: cause.message,
            ...(cause.stack ? { stack: cause.stack } : {}),
          },
        }
      : {}),
  };
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertUnique(values: string[], name: string): void {
  const duplicate = values.find((value, index) => values.indexOf(value) !== index);
  if (duplicate) throw new Error(`${name} contains duplicate id ${JSON.stringify(duplicate)}`);
}

function rotate<T>(values: T[], offset: number): T[] {
  if (values.length < 2) return values;
  const normalized = offset % values.length;
  return [...values.slice(normalized), ...values.slice(0, normalized)];
}

async function runWithTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const task = run(controller.signal);
  const deadline = new Promise<typeof timeoutMarker>((resolve) => {
    timeout = setTimeout(() => {
      const error = new EvalTimeoutError(timeoutMs);
      controller.abort(error);
      resolve(timeoutMarker);
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([task, deadline]);
    if (result !== timeoutMarker) return result;
    // AgentThread normally settles immediately after abort. Give cleanup a
    // bounded grace period so timed-out runs do not overlap the next case.
    await Promise.race([
      task.catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
    throw new EvalTimeoutError(timeoutMs);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (controller.signal.aborted) void task.catch(() => undefined);
  }
}

async function executeRun<TObservation, TScenario extends EvalScenario<TObservation>>(input: {
  suite: EvalSuite<TScenario>;
  scenario: TScenario;
  variant: EvalVariant<TScenario, TObservation>;
  repetition: number;
  executionIndex: number;
  timeoutMs: number;
}): Promise<EvalRunRecord> {
  const startedAt = new Date();
  const startedPerformance = performance.now();
  let harnessOutput: EvalHarnessOutput<TObservation> | undefined;
  let executionError: unknown;
  let errorStage: EvalErrorStage = "execution";

  try {
    harnessOutput = await runWithTimeout(input.timeoutMs, (signal) =>
      input.variant.run(input.scenario, { repetition: input.repetition, signal }),
    );
  } catch (error) {
    executionError = error;
    errorStage =
      error instanceof EvalTimeoutError
        ? "timeout"
        : error instanceof EvalStageError
          ? error.stage
          : "execution";
  }

  const finishedAt = new Date();
  const base = {
    id: `${input.suite.id}:${input.scenario.id}:${input.variant.id}:${input.repetition}`,
    suiteId: input.suite.id,
    scenarioId: input.scenario.id,
    variantId: input.variant.id,
    repetition: input.repetition,
    executionIndex: input.executionIndex,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    input: input.scenario.input,
  };
  const wallTimeMs = performance.now() - startedPerformance;

  if (executionError || !harnessOutput) {
    return {
      ...base,
      status: "error",
      telemetry: { wallTimeMs },
      error: errorDetails(executionError ?? new Error("harness returned no output"), errorStage),
    };
  }

  try {
    const assessment = await input.scenario.evaluate(harnessOutput.observation);
    return {
      ...base,
      status: assessment.passed ? "passed" : "failed",
      output: toJsonValue(harnessOutput.observation),
      assessment,
      telemetry: { ...harnessOutput.telemetry, wallTimeMs },
    };
  } catch (error) {
    return {
      ...base,
      status: "error",
      output: toJsonValue(harnessOutput.observation),
      telemetry: { ...harnessOutput.telemetry, wallTimeMs },
      error: errorDetails(error, "scoring"),
    };
  }
}

export async function runEvalSuite<
  TObservation,
  TScenario extends EvalScenario<TObservation>,
>(
  suite: EvalSuite<TScenario>,
  variants: Array<EvalVariant<TScenario, TObservation>>,
  options: RunEvalSuiteOptions = {},
): Promise<RunEvalSuiteResult> {
  const repetitions = options.repetitions ?? 1;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const concurrency = options.concurrency ?? 1;
  assertPositiveInteger(repetitions, "repetitions");
  assertPositiveInteger(timeoutMs, "timeoutMs");
  assertPositiveInteger(concurrency, "concurrency");
  if (suite.scenarios.length === 0) throw new Error(`eval suite ${suite.id} has no scenarios`);
  if (variants.length === 0) throw new Error(`eval suite ${suite.id} has no variants`);
  assertUnique(suite.scenarios.map((scenario) => scenario.id), "scenarios");
  assertUnique(variants.map((variant) => variant.id), "variants");

  const plan: EvalRunPlan = {
    suiteId: suite.id,
    suiteDescription: suite.description,
    repetitions,
    timeoutMs,
    scenarios: suite.scenarios.map((scenario) => ({
      id: scenario.id,
      description: scenario.description,
      tags: scenario.tags ?? [],
    })),
    variants: variants.map((variant) => ({
      id: variant.id,
      description: variant.description,
      metadata: variant.metadata,
    })),
  };
  await options.hooks?.onPlan?.(plan);

  const records: EvalRunRecord[] = [];
  let executionIndex = 0;

  // 工作单元 = (repetition, scenario)；单元内 variant 按轮转顺序串行，
  // 保住配对比较（同 scenario/repetition 的 baseline 与 candidate 时间上相邻）。
  const units: Array<{ repetition: number; scenario: TScenario }> = [];
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    for (const scenario of suite.scenarios) units.push({ repetition, scenario });
  }

  let unitCursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = unitCursor++;
      const unit = units[index];
      if (!unit) return;
      // Rotate execution order to reduce provider-load and time-of-day bias while
      // preserving scenario/repetition pairing for baseline comparisons.
      for (const variant of rotate(variants, unit.repetition - 1)) {
        executionIndex += 1;
        const record = await executeRun({
          suite,
          scenario: unit.scenario,
          variant,
          repetition: unit.repetition,
          executionIndex,
          timeoutMs,
        });
        records.push(record);
        await options.hooks?.onRunComplete?.(record);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, units.length) }, () => worker()),
  );

  const summary = buildEvalSummary(
    suite.id,
    variants.map((variant) => variant.id),
    suite.scenarios.map((scenario) => scenario.id),
    records,
  );
  await options.hooks?.onComplete?.(summary);
  return { plan, records, summary };
}
