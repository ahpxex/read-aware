import { runEvalCli } from "./evals/cli";
import { evalSuites } from "./evals/suites";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  await runEvalCli(["--help"]);
} else {
  for (const suiteId of Object.keys(evalSuites)) {
    await runEvalCli([suiteId, ...args]);
  }
}
