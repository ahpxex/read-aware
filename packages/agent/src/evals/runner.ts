import { toJsonValue } from "./json";
import { buildEvalSummary } from "./summary";
import { fingerprintJson, fingerprintSuite } from "./fingerprint";
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
  /** Judge/scoring configuration that changes the meaning of a score. */
  definitionMetadata?: import("./types").JsonValue;
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
    const assessment = await runWithTimeout(input.timeoutMs, (signal) =>
      Promise.resolve(input.scenario.evaluate(harnessOutput.observation, { signal })),
    );
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
      error: errorDetails(error, error instanceof EvalTimeoutError ? "timeout" : "scoring"),
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

  const definitionHash = fingerprintSuite(
    suite as unknown as EvalSuite<EvalScenario<unknown>>,
    options.definitionMetadata,
  );
  const plan: EvalRunPlan = {
    suiteId: suite.id,
    suiteDisplayName: suite.displayName,
    definitionHash,
    ...(options.definitionMetadata === undefined
      ? {}
      : { definitionMetadata: options.definitionMetadata }),
    suiteDescription: suite.description,
    repetitions,
    timeoutMs,
    scenarios: suite.scenarios.map((scenario) => ({
      id: scenario.id,
      description: scenario.description,
      tags: scenario.tags ?? [],
      inputHash: fingerprintJson(scenario.input),
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

  // 工作单元 = (repetition, scenario, variant)，统一并发池——多 provider
  // 对比时各 variant 真并行（跨 provider 的限流池本就独立，串行只是白等）。
  // 展开顺序按 repetition 轮转 variant 起点：同一 scenario 的各 variant 在
  // 队列里相邻（时间上仍然贴近，配对比较的时段偏差小），且没有哪个
  // variant 永远排最后吃满时段漂移。配对比较本身按 (scenario, repetition)
  // 事后配对，与执行顺序无关。
  const units: Array<{ repetition: number; scenario: TScenario; variant: (typeof variants)[number] }> =
    [];
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    for (const scenario of suite.scenarios) {
      for (const variant of rotate(variants, repetition - 1)) {
        units.push({ repetition, scenario, variant });
      }
    }
  }

  let unitCursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = unitCursor++;
      const unit = units[index];
      if (!unit) return;
      executionIndex += 1;
      const record = await executeRun({
        suite,
        scenario: unit.scenario,
        variant: unit.variant,
        repetition: unit.repetition,
        executionIndex,
        timeoutMs,
      });
      records.push(record);
      await options.hooks?.onRunComplete?.(record);
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
    new Map(suite.scenarios.map((scenario) => [scenario.id, scenario.tags ?? []])),
    definitionHash,
    suite.displayName,
  );
  await options.hooks?.onComplete?.(summary);
  return { plan, records, summary };
}
