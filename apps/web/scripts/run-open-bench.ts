/**
 * Measure what opening a section costs the layout engine, on real books.
 *
 *   bun scripts/run-open-bench.ts ~/Downloads/books --only 卡拉马佐夫        # from apps/web
 *   bun scripts/run-open-bench.ts <dir> --only <text> --cpu 4 --runs 3 --modes scroll,paginated-single
 *
 * Each book opens in the corpus probe page (`tests/corpus/probe.ts`: the reader's own
 * parser, stylesheet and load handlers) at a phone-sized viewport with the CPU throttled.
 * Its largest, median and first sections are navigated to in turn; for each navigation the
 * script reports the wall time until `goTo` resolves and until the page has painted, and
 * Chrome's own accounting of that interval: layout, style and script time, and how many
 * layouts ran. Navigations alternate between sections, so every one is a cold section load.
 *
 * Chrome (Blink) only: the numbers rank the engine's work, they are not device timings.
 */
import { createReadStream, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Plugin } from "vite";
import { launchHeadlessChrome, type HeadlessChrome } from "./headless-chrome";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const flags = new Map<string, string>();
const positional: string[] = [];
for (let index = 0; index < argv.length; index++) {
  const arg = argv[index]!;
  if (arg.startsWith("--")) flags.set(arg, argv[++index] ?? "");
  else positional.push(arg);
}
const dir = positional[0];
if (!dir) {
  console.error("usage: bun scripts/run-open-bench.ts <books dir> [--only text] [--cpu rate] [--runs n]");
  console.error("       [--modes scroll,paginated-single] [--viewport 412x915] [--json]");
  process.exit(2);
}
const only = (flags.get("--only") ?? "").split(",").filter(Boolean);
const cpu = Number(flags.get("--cpu") ?? 4);
const runs = Math.max(1, Number(flags.get("--runs") ?? 3));
const modes = (flags.get("--modes") ?? "scroll,paginated-single").split(",");
const [viewportWidth, viewportHeight] = (flags.get("--viewport") ?? "412x915").split("x").map(Number) as [
  number,
  number,
];
const json = flags.has("--json");
/** Attribute the largest section's open to the functions that ran (and forced layout). */
const profile = flags.has("--profile");

const files = readdirSync(resolve(dir))
  .filter((name) => /\.(epub|mobi|azw3|fb2|txt)$/i.test(name))
  .filter((name) => !only.length || only.some((text) => name.includes(text)))
  .map((name) => join(resolve(dir), name));
if (!files.length) {
  console.error("No books matched.");
  process.exit(2);
}

function corpusFiles(paths: Map<string, string>): Plugin {
  return {
    name: "readaware-bench-files",
    configureServer(server) {
      server.middlewares.use("/__corpus/", (request, response) => {
        const path = paths.get(decodeURIComponent((request.url ?? "").replace(/^\//, "").split("?")[0]!));
        if (!path) {
          response.statusCode = 404;
          response.end();
          return;
        }
        response.setHeader("Content-Type", "application/octet-stream");
        response.setHeader("Content-Length", String(statSync(path).size));
        createReadStream(path).pipe(response);
      });
    },
  };
}

type Metrics = Record<string, number>;
type Sample = {
  goToMs: number;
  paintedMs: number;
  layoutMs: number;
  styleMs: number;
  scriptMs: number;
  taskMs: number;
  layouts: number;
  styles: number;
  elements: number;
  chars: number;
  pages: number | null;
};

type CpuProfile = {
  nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }[];
  samples?: number[];
  timeDeltas?: number[];
};

/** Self time per function, with the chain of callers for the heaviest ones. */
function printProfile(cpuProfile: CpuProfile) {
  const nodes = new Map(cpuProfile.nodes.map((node) => [node.id, node]));
  const parents = new Map<number, number>();
  for (const node of cpuProfile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
  const name = (id: number) => {
    const { functionName, url, lineNumber } = nodes.get(id)!.callFrame;
    const file = url.split("/").pop()?.split("?")[0] ?? "";
    return `${functionName || "(anonymous)"}${file ? ` ${file}:${lineNumber + 1}` : ""}`;
  };
  const self = new Map<string, number>();
  const samples = cpuProfile.samples ?? [];
  const deltas = cpuProfile.timeDeltas ?? [];
  for (let index = 0; index < samples.length; index++) {
    const id = samples[index]!;
    // A native call (a forced layout inside getBoundingClientRect) is charged to the script frame that made it.
    let frame = id;
    while (
      !nodes.get(frame)!.callFrame.url &&
      parents.has(frame) &&
      nodes.get(frame)!.callFrame.functionName !== "(program)" &&
      nodes.get(frame)!.callFrame.functionName !== "(idle)" &&
      nodes.get(frame)!.callFrame.functionName !== "(garbage collector)"
    )
      frame = parents.get(frame)!;
    const leaf = nodes.get(id)!.callFrame;
    const key = frame === id ? name(id) : `${name(frame)} › ${leaf.functionName}`;
    self.set(key, (self.get(key) ?? 0) + (deltas[index] ?? 0) / 1000);
  }
  const rows = [...self].filter(([key]) => !key.startsWith("(idle)")).sort((a, b) => b[1] - a[1]);
  for (const [key, ms] of rows.slice(0, 28)) console.log(`      ${ms.toFixed(1).padStart(7)} ms  ${key}`);
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

async function bench(chrome: HeadlessChrome, origin: string, path: string, id: string) {
  const { targetId, sessionId } = await chrome.newPage();
  const send = <T>(method: string, params: Record<string, unknown> = {}) =>
    chrome.devtools.send<T>(method, params, sessionId);
  const evaluate = async <T>(expression: string): Promise<T> => {
    const { result, exceptionDetails } = await send<{
      result: { value?: unknown };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value as T;
  };
  const metrics = async (): Promise<Metrics> => {
    const { metrics } = await send<{ metrics: { name: string; value: number }[] }>("Performance.getMetrics");
    return Object.fromEntries(metrics.map((metric) => [metric.name, metric.value]));
  };
  try {
    for (const method of ["Runtime.enable", "Page.enable", "Performance.enable"]) await send(method);
    await send("Emulation.setDeviceMetricsOverride", {
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await send("Page.navigate", { url: new URL("tests/corpus/index.html", origin).href });
    for (let waited = 0; !(await evaluate<boolean>("!!window.corpusProbe")); waited += 200) {
      if (waited > 60_000) throw new Error("The probe page did not initialize");
      await Bun.sleep(200);
    }
    await evaluate(
      `(() => { const s = document.getElementById("stage"); s.style.width = "${viewportWidth}px"; s.style.height = "${viewportHeight}px"; })()`,
    );
    const opened = await evaluate<{ ok: boolean; summary?: { sections: number; fixedLayout: boolean } }>(
      `window.corpusProbe.open(${JSON.stringify({ url: `/__corpus/${id}`, name: basename(path), sniffOnly: false })})`,
    );
    if (!opened.ok || opened.summary?.fixedLayout) {
      console.log(`${basename(path)}: skipped (${opened.ok ? "fixed layout" : "did not open"})`);
      return;
    }
    console.log(`\n${basename(path)}`);
    for (const mode of modes) {
      await send("Emulation.setCPUThrottlingRate", { rate: 1 });
      const setup = await evaluate<{ ok: boolean; error: string | null }>(
        `window.corpusProbe.prepareRender(${JSON.stringify(mode)})`,
      );
      if (!setup.ok) {
        console.log(`  ${mode}: ${setup.error}`);
        continue;
      }
      const sections = await evaluate<{ index: number; size: number }[]>(
        `document.querySelector("foliate-view").book.sections.map((s, index) => ({ index, size: s.size, linear: s.linear })).filter((s) => s.linear !== "no")`,
      );
      const bySize = [...sections].sort((a, b) => b.size - a.size);
      const picks = new Map<string, { index: number; size: number }>();
      picks.set("largest", bySize[0]!);
      if (bySize[1]) picks.set("second", bySize[1]);
      picks.set("median", bySize[Math.floor(bySize.length / 2)]!);
      const targets = [...picks].filter(
        ([, section], position, all) => all.findIndex(([, other]) => other.index === section.index) === position,
      );
      // Warm the fonts and the engine's first-use paths on a section that is not measured.
      const warm = sections.find((section) => !targets.some(([, target]) => target.index === section.index));
      if (warm) await evaluate(`document.querySelector("foliate-view").goTo(${warm.index})`);
      await send("Emulation.setCPUThrottlingRate", { rate: cpu });
      const samples = new Map<string, Sample[]>();
      for (let run = 0; run < runs; run++) {
        for (const [label, section] of targets) {
          await evaluate(`new Promise((resolve) => setTimeout(resolve, 150))`);
          const profiled = profile && run === 0 && label === "largest";
          if (profiled) {
            await send("Profiler.enable");
            await send("Profiler.setSamplingInterval", { interval: 200 });
            await send("Profiler.start");
          }
          const before = await metrics();
          const timing = await evaluate<{
            goToMs: number;
            paintedMs: number;
            elements: number;
            chars: number;
            pages: number | null;
          }>(`(async () => {
            const view = document.querySelector("foliate-view");
            const started = performance.now();
            await view.goTo(${section.index});
            const goToMs = performance.now() - started;
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const paintedMs = performance.now() - started;
            const doc = view.renderer.getContents().find((content) => content.index === ${section.index})?.doc;
            return {
              goToMs,
              paintedMs,
              elements: doc?.body.querySelectorAll("*").length ?? 0,
              chars: doc?.body.textContent.length ?? 0,
              pages: "pages" in view.renderer && !view.renderer.scrolled ? view.renderer.pages : null,
            };
          })()`);
          // Late passes (fonts settling, deferred style refreshes) belong to the open as well.
          await evaluate(`new Promise((resolve) => setTimeout(resolve, 400))`);
          const after = await metrics();
          if (profiled) {
            const { profile: cpuProfile } = await send<{ profile: CpuProfile }>("Profiler.stop");
            printProfile(cpuProfile);
          }
          const delta = (name: string) => (after[name]! - before[name]!) * 1000;
          const list = samples.get(label) ?? [];
          list.push({
            ...timing,
            layoutMs: delta("LayoutDuration"),
            styleMs: delta("RecalcStyleDuration"),
            scriptMs: delta("ScriptDuration"),
            taskMs: delta("TaskDuration"),
            layouts: after.LayoutCount! - before.LayoutCount!,
            styles: after.RecalcStyleCount! - before.RecalcStyleCount!,
          });
          samples.set(label, list);
        }
      }
      for (const [label, section] of targets) {
        const list = samples.get(label)!;
        const pick = (key: keyof Sample) => median(list.map((sample) => sample[key] ?? 0));
        const row = {
          mode,
          section: label,
          index: section.index,
          kB: Math.round(section.size / 1024),
          elements: pick("elements"),
          chars: pick("chars"),
          pages: list[0]!.pages,
          goToMs: Math.round(pick("goToMs")),
          paintedMs: Math.round(pick("paintedMs")),
          taskMs: Math.round(pick("taskMs")),
          layoutMs: Math.round(pick("layoutMs")),
          styleMs: Math.round(pick("styleMs")),
          scriptMs: Math.round(pick("scriptMs")),
          layouts: pick("layouts"),
          styles: pick("styles"),
        };
        if (json) console.log(JSON.stringify({ book: basename(path), ...row }));
        else
          console.log(
            `  ${mode.padEnd(17)} ${label.padEnd(8)} #${String(row.index).padEnd(4)} ${String(row.kB).padStart(5)} kB ${String(row.elements).padStart(6)} el | goTo ${String(row.goToMs).padStart(5)}  painted ${String(row.paintedMs).padStart(5)} | task ${String(row.taskMs).padStart(5)} = layout ${String(row.layoutMs).padStart(5)} (${row.layouts}×) + style ${String(row.styleMs).padStart(4)} (${row.styles}×) + script ${String(row.scriptMs).padStart(5)}`,
          );
      }
    }
  } finally {
    await chrome
      .closePage(targetId)
      .catch((error: unknown) => console.warn(`closing the page for ${basename(path)} failed`, error));
  }
}

const build = Bun.spawnSync([process.execPath, "scripts/build-foliate.ts"], {
  cwd: web,
  stdout: "inherit",
  stderr: "inherit",
});
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);
const ids = new Map(files.map((path, index) => [`book-${index}`, path]));
const server = await createServer({
  root: web,
  configFile: resolve(web, "vite.config.ts"),
  logLevel: "warn",
  server: { host: "127.0.0.1", port: 5192, strictPort: false, hmr: false },
  plugins: [corpusFiles(ids)],
});
let chrome: HeadlessChrome | undefined;
let exitCode = 0;
try {
  await server.listen();
  const origin = server.resolvedUrls?.local[0];
  if (!origin) throw new Error("The dev server did not report a local URL");
  chrome = await launchHeadlessChrome();
  console.log(`viewport ${viewportWidth}×${viewportHeight}, CPU ×${cpu}, median of ${runs}`);
  for (const [id, path] of ids) {
    try {
      await bench(chrome, origin, path, id);
    } catch (error) {
      exitCode = 1;
      console.error(`${basename(path)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} finally {
  await chrome?.close();
  await server.close();
}
process.exit(exitCode);
