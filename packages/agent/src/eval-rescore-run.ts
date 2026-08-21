import { parseArgs } from "node:util";
import { AgentEvalJudge, JUDGE_IMPLEMENTATION_VERSION } from "./evals/judge";
import { resolveJudgeCompletion } from "./evals/model-config";
import { rescoreEvalBundle } from "./evals/rescore";

const parsed = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  strict: true,
  options: {
    gate: { type: "boolean" },
    judge: { type: "boolean" },
    "judge-provider": { type: "string" },
    "judge-model": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

const directory = parsed.positionals[0];
if (parsed.values.help || !directory) {
  console.log(
    `Usage: bun run eval:rescore <artifact-directory> [--gate] [--judge] [--judge-provider <id>] [--judge-model <id>]

--judge re-scores rubric scenarios with an LLM judge against the recorded runs
(no re-run of the evaluated model). Default judge provider is deepseek.`,
  );
} else {
  let judge: AgentEvalJudge | undefined;
  let judgeMetadata: Record<string, string | number | boolean> = { enabled: false };
  if (parsed.values.judge) {
    const completion = resolveJudgeCompletion(
      parsed.values["judge-provider"] ?? "deepseek",
      parsed.values["judge-model"],
    );
    judge = new AgentEvalJudge({ complete: completion.complete });
    judgeMetadata = {
      enabled: true,
      provider: completion.metadata.provider,
      model: completion.metadata.model,
      threshold: 0.6,
      implementationVersion: JUDGE_IMPLEMENTATION_VERSION,
    };
    console.log(`Judge: ${completion.metadata.provider}:${completion.metadata.model}`);
  }
  const result = await rescoreEvalBundle(directory, { judge, judgeMetadata });
  console.log(
    `Rescored ${result.summary.runs} runs: ${result.summary.passed} passed, ${result.summary.failed} failed, ${result.summary.errors} errors`,
  );
  if (result.reportPath) console.log(`Report: ${result.reportPath}`);
  if (result.summary.errors > 0 || (parsed.values.gate && result.summary.failed > 0)) {
    process.exitCode = 1;
  }
}
