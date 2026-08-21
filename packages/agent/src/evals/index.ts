/**
 * eval 体系的独立入口（@read-aware/agent/evals）。刻意不并入主 barrel：
 * evals 经 model-config 依赖 node:fs（dev key、真书 fixture 文件），
 * 挂在主入口上会被产品的浏览器 bundle 拉进来并炸掉构建 —— eval-viewer
 * 的 ssrLoadModule 与脚本从这里走，产品只认主入口。
 */
export {
  evalSuites,
  evalSuiteGroups,
  isEvalSuiteId,
  isEvalSuiteGroupId,
  suiteIdsOfGroup,
  type EvalSuiteId,
  type EvalSuiteGroupId,
} from "./suites";
export type { AgentEvalScenario } from "./agent-harness";
export type { EvalSuite, EvalRunRecord, EvalSummary } from "./types";
