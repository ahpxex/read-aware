/**
 * Eval viewer 的数据面走 vite dev 中间件（本地开发工具，dev 模式即产品形态）：
 *  - /api/catalog  套件目录——经 ssrLoadModule 直接加载 @read-aware/agent/evals 的
 *    evalSuites（场景定义天生可序列化），所以不跑 eval 也能浏览"测什么、怎么测"。
 *  - /api/runs     扫描 repo 根与 packages/agent 下的 .eval/ 工件目录。
 *  - /api/runs/:id 单次运行的 manifest + summary + runs.jsonl 全量记录。
 * 工件含书文本与模型输出，属本地诊断数据——server 只绑 localhost。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";

const REPO_ROOT = resolve(__dirname, "../../..");
const EVAL_ROOTS = [join(REPO_ROOT, ".eval"), join(REPO_ROOT, "packages/agent/.eval")];

interface RunListing {
  runId: string;
  suiteId: string;
  generatedAt?: string;
  runs?: number;
  passed?: number;
  failed?: number;
  errors?: number;
  model?: string;
  provider?: string;
  thinkingLevel?: string;
  repetitions?: number;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function listRuns(): RunListing[] {
  const listings: RunListing[] = [];
  for (const root of EVAL_ROOTS) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const directory = join(root, entry);
      try {
        if (!statSync(directory).isDirectory()) continue;
      } catch {
        continue;
      }
      const manifest = readJson(join(directory, "manifest.json")) as
        | {
            runId?: string;
            plan?: {
              suiteId?: string;
              repetitions?: number;
              variants?: Array<{ metadata?: Record<string, unknown> }>;
            };
          }
        | undefined;
      if (!manifest?.plan?.suiteId) continue;
      const summary = readJson(join(directory, "summary.json")) as
        | { generatedAt?: string; runs?: number; passed?: number; failed?: number; errors?: number }
        | undefined;
      const meta = manifest.plan.variants?.[0]?.metadata ?? {};
      listings.push({
        runId: manifest.runId ?? entry,
        suiteId: manifest.plan.suiteId,
        generatedAt: summary?.generatedAt,
        runs: summary?.runs,
        passed: summary?.passed,
        failed: summary?.failed,
        errors: summary?.errors,
        model: typeof meta.model === "string" ? meta.model : undefined,
        provider: typeof meta.provider === "string" ? meta.provider : undefined,
        thinkingLevel: typeof meta.thinkingLevel === "string" ? meta.thinkingLevel : undefined,
        repetitions: manifest.plan.repetitions,
      });
    }
  }
  return listings.sort((a, b) => (b.generatedAt ?? b.runId).localeCompare(a.generatedAt ?? a.runId));
}

function findRunDirectory(runId: string): string | undefined {
  // runId 由 EvalArtifactStore 生成（safeSegment），不含路径分隔符；再防御一次。
  if (!/^[A-Za-z0-9._-]+$/.test(runId)) return undefined;
  for (const root of EVAL_ROOTS) {
    const directory = join(root, runId);
    if (existsSync(join(directory, "manifest.json"))) return directory;
  }
  return undefined;
}

function sendJson(res: import("node:http").ServerResponse, value: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(value));
}

function evalDataPlugin(): Plugin {
  let catalogCache: unknown;
  return {
    name: "readaware-eval-data",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith("/api/")) return next();
        try {
          if (url.pathname === "/api/catalog") {
            if (!catalogCache) {
              // ssrLoadModule 现场编译 agent 包 TS；套件构造会加载真书
              // fixture 全文（一次约一两秒），进程内缓存。
              const agent = (await server.ssrLoadModule("@read-aware/agent/evals")) as {
                evalSuites: Record<
                  string,
                  {
                    id: string;
                    code: string;
                    description: string;
                    scenarios: Array<{
                      id: string;
                      description: string;
                      tags?: string[];
                      input: unknown;
                    }>;
                  }
                >;
              };
              catalogCache = Object.values(agent.evalSuites)
                .map((suite) => ({
                  id: suite.id,
                  code: suite.code,
                  description: suite.description,
                  scenarios: suite.scenarios.map((scenario, index) => ({
                    ref: `${suite.code}.${index + 1}`,
                    id: scenario.id,
                    description: scenario.description,
                    tags: scenario.tags ?? [],
                    input: scenario.input,
                  })),
                }))
                .sort((a, b) => a.code.localeCompare(b.code));
            }
            return sendJson(res, catalogCache);
          }
          if (url.pathname === "/api/runs") {
            return sendJson(res, listRuns());
          }
          if (url.pathname === "/api/attention") {
            // 各套件"最新一次 run"里的失败/错误场景聚合——打开页面第一眼
            // 要看的就是"现在什么是红的、为什么"。
            const latest = new Map<string, RunListing & { directory?: string }>();
            for (const root of EVAL_ROOTS) {
              if (!existsSync(root)) continue;
              for (const entry of readdirSync(root)) {
                const directory = join(root, entry);
                const manifest = readJson(join(directory, "manifest.json")) as
                  | { runId?: string; plan?: { suiteId?: string } }
                  | undefined;
                const summary = readJson(join(directory, "summary.json")) as
                  | { generatedAt?: string }
                  | undefined;
                if (!manifest?.plan?.suiteId || !summary?.generatedAt) continue;
                const known = latest.get(manifest.plan.suiteId);
                if (!known || (known.generatedAt ?? "") < summary.generatedAt) {
                  latest.set(manifest.plan.suiteId, {
                    runId: manifest.runId ?? entry,
                    suiteId: manifest.plan.suiteId,
                    generatedAt: summary.generatedAt,
                    directory,
                  } as RunListing & { directory: string });
                }
              }
            }
            const attention: Array<{
              suiteId: string;
              runId: string;
              scenarioId: string;
              status: string;
              failedChecks: Array<{ id: string; message: string }>;
            }> = [];
            for (const run of Array.from(latest.values())) {
              const directory = (run as { directory?: string }).directory;
              if (!directory || !existsSync(join(directory, "runs.jsonl"))) continue;
              for (const line of readFileSync(join(directory, "runs.jsonl"), "utf8").split("\n")) {
                if (!line) continue;
                const record = JSON.parse(line) as {
                  scenarioId: string;
                  status: string;
                  assessment?: { checks?: Array<{ id: string; message: string; passed: boolean }> };
                  error?: { message: string };
                };
                if (record.status === "passed") continue;
                attention.push({
                  suiteId: run.suiteId,
                  runId: run.runId,
                  scenarioId: record.scenarioId,
                  status: record.status,
                  failedChecks:
                    record.assessment?.checks
                      ?.filter((check) => !check.passed)
                      .map(({ id, message }) => ({ id, message })) ??
                    (record.error ? [{ id: "error", message: record.error.message }] : []),
                });
              }
            }
            return sendJson(res, attention);
          }
          const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
          if (runMatch) {
            const directory = findRunDirectory(runMatch[1]!);
            if (!directory) return sendJson(res, { error: "run not found" }, 404);
            const manifest = readJson(join(directory, "manifest.json"));
            const summary = readJson(join(directory, "summary.json"));
            const rawRecords = existsSync(join(directory, "runs.jsonl"))
              ? readFileSync(join(directory, "runs.jsonl"), "utf8")
              : "";
            const records = rawRecords
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line));
            return sendJson(res, { manifest, summary, records });
          }
          return sendJson(res, { error: "unknown endpoint" }, 404);
        } catch (error) {
          return sendJson(res, { error: String(error) }, 500);
        }
      });
    },
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [react(), evalDataPlugin()],
  server: { host: "127.0.0.1" },
});
