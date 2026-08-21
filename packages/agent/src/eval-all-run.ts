import { runEvalCli } from "./evals/cli";

// 两组顺序串行（behavior → realbook）；组内展开、逐套件落工件/trend 的
// 逻辑全部在 cli.ts 的组选择器里，这里只是"全部"的糖。
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  await runEvalCli(["--help"]);
} else {
  await runEvalCli(["behavior", ...args]);
  await runEvalCli(["realbook", ...args]);
}
