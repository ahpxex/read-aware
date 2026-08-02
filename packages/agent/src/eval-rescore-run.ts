import { rescoreEvalBundle } from "./evals/rescore";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  console.log("Usage: bun run eval:rescore <artifact-directory> [--gate]");
} else {
  const gate = args.includes("--gate");
  const directory = args.find((argument) => !argument.startsWith("-"));
  if (!directory) throw new Error("artifact directory is required");
  const result = await rescoreEvalBundle(directory);
  console.log(
    `Rescored ${result.summary.runs} runs: ${result.summary.passed} passed, ${result.summary.failed} failed, ${result.summary.errors} errors`,
  );
  if (result.reportPath) console.log(`Report: ${result.reportPath}`);
  if (result.summary.errors > 0 || (gate && result.summary.failed > 0)) process.exitCode = 1;
}
