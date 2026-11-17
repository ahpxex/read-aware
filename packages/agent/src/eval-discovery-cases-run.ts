/**
 * Rebuild the tool-discovery benchmark from recorded eval runs.
 *
 *   bun run eval:discovery-cases            # all recorded runs
 *   bun run eval:discovery-cases 2026-11-01 # runs started on or after a date
 *
 * A case is one discovery query a model really issued, with the tools it went
 * on to call in that run that were not in its initial tool list. The benchmark
 * test (tools/discovery-benchmark.test.ts) asks that one discovery now loads
 * them. A query/tool pair counts only when at least two runs agree, so one
 * run's detour does not become an expectation.
 *
 * The eval artifacts are local and git-ignored; the generated JSON is the
 * checked-in fixture. Run this after eval batches that exercise discovery.
 */
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";

type RecordedTool = { name?: string; args?: { catalog?: string; query?: string }; isError?: boolean };
type RecordedRun = {
  startedAt?: string;
  input?: { scope?: { kind?: string } };
  output?: {
    tools?: RecordedTool[];
    modelRequests?: Array<{ context?: { tools?: Array<{ name?: string }> } }>;
  };
};

const DISCOVERY = "get_host_capabilities";
const MIN_AGREEING_RUNS = 2;
const repoRoot = resolve(import.meta.dir, "../../..");
const since = process.argv[2] ?? "";

const files = new Set<string>();
for (const root of [join(repoRoot, ".eval"), join(repoRoot, "packages/agent/.eval")])
  for await (const file of new Bun.Glob("**/runs.jsonl").scan({ cwd: root, followSymlinks: true, absolute: true }))
    files.add(realpathSync(file));

type Tally = { runs: number; tools: Map<string, number> };
const tallies = new Map<string, Tally>();
const seen = new Set<string>();
let runs = 0;
for (const file of [...files].sort()) {
  for (const line of (await Bun.file(file).text()).split("\n")) {
    if (!line.trim()) continue;
    let run: RecordedRun & { id?: string };
    try {
      run = JSON.parse(line) as RecordedRun & { id?: string };
    } catch {
      // A run interrupted mid-write leaves a truncated last line; it holds no complete case.
      continue;
    }
    const scope = run.input?.scope?.kind;
    if ((scope !== "global" && scope !== "book") || (run.startedAt ?? "") < since) continue;
    const identity = `${run.id}@${run.startedAt}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const tools = run.output?.tools ?? [];
    const first = tools.findIndex(
      (tool) => tool.name === DISCOVERY && !tool.isError && tool.args?.catalog === "tools" && tool.args.query?.trim(),
    );
    if (first < 0) continue;
    runs++;
    const initial = new Set((run.output?.modelRequests?.[0]?.context?.tools ?? []).map((tool) => tool.name));
    const needed = new Set(
      tools
        .slice(first + 1)
        .filter((tool) => tool.name && tool.name !== DISCOVERY && !tool.isError && !initial.has(tool.name))
        .map((tool) => tool.name!),
    );
    const query = tools[first]!.args!.query!.trim().toLowerCase().split(/\s+/).join(" ");
    const key = `${scope}\n${query}`;
    const tally = tallies.get(key) ?? { runs: 0, tools: new Map() };
    tally.runs++;
    for (const name of needed) tally.tools.set(name, (tally.tools.get(name) ?? 0) + 1);
    tallies.set(key, tally);
  }
}

const cases = [...tallies]
  .map(([key, tally]) => {
    const [scope, query] = key.split("\n") as [string, string];
    const expect = [...tally.tools]
      .filter(([, count]) => count >= MIN_AGREEING_RUNS)
      .map(([name]) => name)
      .sort();
    return { scope, query, runs: tally.runs, expect };
  })
  .filter((item) => item.expect.length > 0)
  .sort((a, b) => a.scope.localeCompare(b.scope, "en") || a.query.localeCompare(b.query, "en"));

const target = join(import.meta.dir, "tools/discovery-cases.json");
await Bun.write(target, `${JSON.stringify(cases, null, 2)}\n`);
console.log(`${files.size} run files, ${runs} runs with a discovery, ${cases.length} cases -> ${target}`);
