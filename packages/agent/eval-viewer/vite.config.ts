/**
 * Eval viewer 的数据面走 vite dev 中间件（本地开发工具，dev 模式即产品形态）：
 *  - /api/catalog  套件目录——经 ssrLoadModule 直接加载 @read-aware/agent/evals 的
 *    evalSuites（场景定义天生可序列化），所以不跑 eval 也能浏览"测什么、怎么测"。
 *  - /api/runs     扫描 repo 根与 packages/agent 下的 .eval/ 工件目录——
 *    没有 summary.json 的 bundle 是进行中的 run（runs.jsonl 逐行落盘），
 *    照样列出并给出实时进度；目录十分钟没动静则判定为中断（stale）。
 *  - /api/runs/:id 单次运行的 manifest + summary + runs.jsonl 全量记录。
 *  - /api/events   SSE：fs.watch 两个工件根，有任何写入即广播——前端借此
 *    在 eval 跑动时自动刷新，不需要手动刷新页面。
 * 工件含书文本与模型输出，属本地诊断数据——server 只绑 localhost。
 */
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, watch } from "node:fs";
import { join, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ManualEvalSession } from "../src/evals/manual-session";
import {
  readHumanReviews,
  readManualSessions,
  reviewTargetExists,
  saveHumanReview,
  saveManualSession,
} from "./server/review-store";
import type {
  CreateManualSessionInput,
  HumanReviewInput,
  ManualReviewSession,
  ManualReviewTurn,
} from "./src/reviews";

const REPO_ROOT = resolve(__dirname, "../../..");
const EVAL_ROOTS = [join(REPO_ROOT, ".eval"), join(REPO_ROOT, "packages/agent/.eval")];

interface RunListing {
  runId: string;
  suiteId: string;
  status: "running" | "stale" | "complete";
  generatedAt?: string;
  runs?: number;
  passed?: number;
  failed?: number;
  errors?: number;
  /** 计划内的总 run 数（场景 × 变体 × 重复）——进行中 run 的进度分母。 */
  total?: number;
  model?: string;
  provider?: string;
  thinkingLevel?: string;
  repetitions?: number;
}

/** 进行中判定的静默阈值：目录超过这个时长没有写入即视为中断。 */
const STALE_AFTER_MS = 10 * 60 * 1000;

function liveProgress(directory: string): { runs: number; passed: number; failed: number; errors: number } {
  const counts = { runs: 0, passed: 0, failed: 0, errors: 0 };
  const path = join(directory, "runs.jsonl");
  if (!existsSync(path)) return counts;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const record = JSON.parse(line) as { status?: string };
      counts.runs += 1;
      if (record.status === "passed") counts.passed += 1;
      else if (record.status === "error") counts.errors += 1;
      else counts.failed += 1;
    } catch {
      // 半行（正在写入）——跳过
    }
  }
  return counts;
}

function livenessOf(directory: string): "running" | "stale" {
  try {
    const candidates = [join(directory, "runs.jsonl"), directory];
    const newest = Math.max(
      ...candidates.filter((path) => existsSync(path)).map((path) => statSync(path).mtimeMs),
    );
    return Date.now() - newest > STALE_AFTER_MS ? "stale" : "running";
  } catch {
    return "stale";
  }
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
            createdAt?: string;
            plan?: {
              suiteId?: string;
              repetitions?: number;
              scenarios?: Array<unknown>;
              variants?: Array<{ metadata?: Record<string, unknown> }>;
            };
          }
        | undefined;
      if (!manifest?.plan?.suiteId) continue;
      const summary = readJson(join(directory, "summary.json")) as
        | { generatedAt?: string; runs?: number; passed?: number; failed?: number; errors?: number }
        | undefined;
      const meta = manifest.plan.variants?.[0]?.metadata ?? {};
      const total =
        (manifest.plan.scenarios?.length ?? 0) *
        (manifest.plan.repetitions ?? 1) *
        Math.max(1, manifest.plan.variants?.length ?? 1);
      const progress = summary ? undefined : liveProgress(directory);
      listings.push({
        runId: manifest.runId ?? entry,
        suiteId: manifest.plan.suiteId,
        status: summary ? "complete" : livenessOf(directory),
        generatedAt: summary?.generatedAt ?? manifest.createdAt,
        runs: summary?.runs ?? progress?.runs,
        passed: summary?.passed ?? progress?.passed,
        failed: summary?.failed ?? progress?.failed,
        errors: summary?.errors ?? progress?.errors,
        ...(total ? { total } : {}),
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

async function readRequestJson(req: import("node:http").IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 100_000) throw new Error("request body is too large");
  }
  if (!body) return {};
  return JSON.parse(body);
}

const THINKING_LEVELS = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function thinkingLevel(value: unknown): ThinkingLevel {
  return typeof value === "string" && THINKING_LEVELS.has(value as ThinkingLevel)
    ? (value as ThinkingLevel)
    : "medium";
}

function evalDataPlugin(): Plugin {
  let catalogCache: unknown;
  return {
    name: "readaware-eval-data",
    configureServer(server: ViteDevServer) {
      const manualSessionHandles = new Map<
        string,
        {
          handle: ManualEvalSession;
          directory: string;
          record: ManualReviewSession;
          touchedAt: number;
        }
      >();
      // 动态面：watch 两个工件根，任何写入（新 bundle、runs.jsonl 追加、
      // summary 落盘）去抖后广播给所有 SSE 客户端——viewer 随 eval 直播。
      const sseClients = new Set<import("node:http").ServerResponse>();
      let debounce: ReturnType<typeof setTimeout> | undefined;
      const broadcast = () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          for (const client of sseClients) client.write(`data: changed\n\n`);
        }, 400);
      };
      for (const root of EVAL_ROOTS) {
        try {
          if (existsSync(root)) watch(root, { recursive: true }, broadcast);
        } catch {
          // watch 失败只是丢直播，不影响静态取数
        }
      }
      const heartbeat = setInterval(() => {
        for (const client of sseClients) client.write(`: ping\n\n`);
      }, 25_000);
      heartbeat.unref?.();
      const sessionCleanup = setInterval(() => {
        const cutoff = Date.now() - 30 * 60 * 1000;
        for (const [id, session] of manualSessionHandles) {
          if (session.touchedAt >= cutoff) continue;
          session.handle.dispose();
          manualSessionHandles.delete(id);
        }
      }, 5 * 60 * 1000);
      sessionCleanup.unref?.();
      server.httpServer?.once("close", () => {
        clearInterval(heartbeat);
        clearInterval(sessionCleanup);
        for (const session of manualSessionHandles.values()) session.handle.dispose();
        manualSessionHandles.clear();
      });

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
                    displayName: string;
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
                evalSuiteGroups: Record<
                  string,
                  { id: string; description: string; suiteIds: string[] }
                >;
              };
              catalogCache = Object.entries(agent.evalSuiteGroups)
                .flatMap(([, definition]) =>
                  definition.suiteIds.map((suiteId) => ({
                    suite: agent.evalSuites[suiteId]!,
                    group: definition.id as "behavior" | "realbook",
                  })),
                )
                .map(({ suite, group }) => ({
                  id: suite.id,
                  displayName: suite.displayName,
                  code: suite.code,
                  group,
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
          if (url.pathname === "/api/events") {
            res.writeHead(200, {
              "content-type": "text/event-stream",
              "cache-control": "no-cache",
              connection: "keep-alive",
            });
            res.write(`data: connected\n\n`);
            sseClients.add(res);
            req.on("close", () => sseClients.delete(res));
            return;
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
          const reviewMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/human-reviews$/);
          if (reviewMatch && req.method === "POST") {
            const directory = findRunDirectory(reviewMatch[1]!);
            if (!directory) return sendJson(res, { error: "run not found" }, 404);
            const input = (await readRequestJson(req)) as HumanReviewInput;
            if (typeof input.targetId !== "string" || !(await reviewTargetExists(directory, input.targetId))) {
              return sendJson(res, { error: "review target not found in this run" }, 404);
            }
            const review = await saveHumanReview(directory, input);
            broadcast();
            return sendJson(res, review);
          }
          const createSessionMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/manual-sessions$/);
          if (createSessionMatch && req.method === "POST") {
            const runId = createSessionMatch[1]!;
            const directory = findRunDirectory(runId);
            if (!directory) return sendJson(res, { error: "run not found" }, 404);
            const body = (await readRequestJson(req)) as Partial<CreateManualSessionInput>;
            if (typeof body.scenarioId !== "string" || typeof body.variantId !== "string") {
              return sendJson(res, { error: "scenarioId and variantId are required" }, 400);
            }
            const manifest = readJson(join(directory, "manifest.json")) as
              | {
                  plan?: {
                    suiteId?: string;
                    variants?: Array<{ id?: string; metadata?: Record<string, unknown> }>;
                  };
                }
              | undefined;
            const suiteId = manifest?.plan?.suiteId;
            const variant = manifest?.plan?.variants?.find((entry) => entry.id === body.variantId);
            if (!suiteId || !variant) {
              return sendJson(res, { error: "run variant not found" }, 404);
            }
            const agent = (await server.ssrLoadModule("@read-aware/agent/evals")) as {
              evalSuites: Record<string, { scenarios: Array<{ id: string }> }>;
              createManualEvalSession: (options: {
                scenario: unknown;
                provider: string;
                modelId?: string;
                thinkingLevel: ThinkingLevel;
                inheritSelection: boolean;
              }) => Promise<ManualEvalSession>;
            };
            const scenario = agent.evalSuites[suiteId]?.scenarios.find(
              (entry) => entry.id === body.scenarioId,
            );
            if (!scenario) return sendJson(res, { error: "scenario not found" }, 404);
            const metadata = variant.metadata ?? {};
            if (typeof metadata.provider !== "string") {
              return sendJson(res, { error: "variant provider is missing" }, 400);
            }
            const handle = await agent.createManualEvalSession({
              scenario,
              provider: metadata.provider,
              ...(typeof metadata.model === "string" ? { modelId: metadata.model } : {}),
              thinkingLevel: thinkingLevel(metadata.thinkingLevel),
              inheritSelection: body.inheritSelection === true,
            });
            const id = `manual-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
            const record: ManualReviewSession = {
              id,
              runId,
              scenarioId: body.scenarioId,
              variantId: body.variantId,
              createdAt: new Date().toISOString(),
              model: {
                provider: handle.metadata.provider,
                id: handle.metadata.model,
                thinkingLevel: handle.metadata.thinkingLevel,
              },
              inheritSelection: body.inheritSelection === true,
              turns: [],
              active: true,
            };
            manualSessionHandles.set(id, {
              handle,
              directory,
              record,
              touchedAt: Date.now(),
            });
            await saveManualSession(directory, { ...record, active: undefined });
            broadcast();
            return sendJson(res, record);
          }
          const askSessionMatch = url.pathname.match(/^\/api\/manual-sessions\/([^/]+)\/turns$/);
          if (askSessionMatch && req.method === "POST") {
            const session = manualSessionHandles.get(askSessionMatch[1]!);
            if (!session) {
              return sendJson(
                res,
                { error: "manual session expired; start a new session from this scenario" },
                410,
              );
            }
            const body = (await readRequestJson(req)) as { question?: unknown };
            if (typeof body.question !== "string" || !body.question.trim()) {
              return sendJson(res, { error: "question is required" }, 400);
            }
            if (body.question.length > 20_000) {
              return sendJson(res, { error: "question is too long" }, 400);
            }
            const observation = await session.handle.ask(body.question);
            const turn: ManualReviewTurn = {
              id: `${session.record.id}:${session.record.turns.length + 1}`,
              question: body.question.trim(),
              answer: observation.answer,
              tools: observation.tools.map(({ name, args, output, isError }) => ({
                name,
                ...(args === undefined ? {} : { args }),
                ...(output === undefined ? {} : { output }),
                ...(isError === undefined ? {} : { isError }),
              })),
              interactions: observation.interactions.map(({ phase, kind, value }) => ({
                phase,
                ...(kind === undefined ? {} : { kind }),
                value,
              })),
              telemetry: observation.telemetry,
              createdAt: new Date().toISOString(),
            };
            session.record.turns.push(turn);
            session.touchedAt = Date.now();
            await saveManualSession(session.directory, {
              ...session.record,
              active: undefined,
            });
            broadcast();
            return sendJson(res, turn);
          }
          const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
          if (runMatch) {
            const directory = findRunDirectory(runMatch[1]!);
            if (!directory) return sendJson(res, { error: "run not found" }, 404);
            const manifest = readJson(join(directory, "manifest.json"));
            const rescoreRoot = join(directory, "rescored");
            const rescores = existsSync(rescoreRoot)
              ? readdirSync(rescoreRoot)
                  .filter((id) => /^[A-Za-z0-9._-]+$/.test(id))
                  .flatMap((id) => {
                    const value = readJson(join(rescoreRoot, id, "manifest.json")) as
                      | { createdAt?: string; compatibility?: { comparable?: boolean } }
                      | undefined;
                    return value ? [{ id, ...value }] : [];
                  })
                  .sort((a, b) => (b.createdAt ?? b.id).localeCompare(a.createdAt ?? a.id))
              : [];
            const requestedRescore = url.searchParams.get("rescore") ?? undefined;
            const selectedRescore = rescores.some((entry) => entry.id === requestedRescore)
              ? requestedRescore
              : undefined;
            const dataDirectory = selectedRescore
              ? join(rescoreRoot, selectedRescore)
              : directory;
            const summary = readJson(join(dataDirectory, "summary.json"));
            const rawRecords = existsSync(join(dataDirectory, "runs.jsonl"))
              ? readFileSync(join(dataDirectory, "runs.jsonl"), "utf8")
              : "";
            const records: unknown[] = [];
            for (const line of rawRecords.split("\n")) {
              if (!line) continue;
              try {
                records.push(JSON.parse(line));
              } catch {
                // 进行中 run 的半行
              }
            }
            const status = summary ? "complete" : livenessOf(directory);
            const [humanReviews, storedManualSessions] = await Promise.all([
              readHumanReviews(directory),
              readManualSessions(directory),
            ]);
            const manualSessions = storedManualSessions.map((session) => ({
              ...session,
              active: manualSessionHandles.has(session.id),
            }));
            return sendJson(res, {
              manifest,
              summary,
              records,
              status,
              rescores,
              humanReviews,
              manualSessions,
              ...(selectedRescore ? { selectedRescore } : {}),
            });
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
  plugins: [tailwindcss(), react(), evalDataPlugin()],
  server: { host: "127.0.0.1" },
});
