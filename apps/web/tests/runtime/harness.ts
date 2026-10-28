/**
 * Page entry for the reader runtime regression suites (`tests/runtime/index.html`).
 *
 * The suites need a real layout engine (iframes, CSS columns, canvas), so they run in a
 * browser page served by the web dev server, never in `bun test`. The engine is loaded
 * from the emitted static modules under `/foliate-js/`, exactly as the app loads it: Vite
 * must not rewrite or bundle those modules, so their URLs are built at runtime.
 *
 * - `bun run test:runtime` drives this page in headless Chrome and reports the results.
 * - The authoritative WebKit run is the foreground Tauri webview: navigate the dev window
 *   to `/tests/runtime/index.html` and read `window.__runtimeRegressions`.
 *
 * Outside Tauri the page installs an inert `__TAURI_INTERNALS__` marker; the suites only
 * use it to refuse running in environments without a real layout engine.
 */
import type * as CFI from "../../foliate-js/src/epubcfi";
import type * as ViewModule from "../../foliate-js/src/view";
import type * as PaginatorModule from "../../foliate-js/src/paginator";
import { runChapterRegressions } from "./foliate-chapter-regressions";
import { runEPUBRegressions } from "./foliate-epub-regressions";
import { runLayoutRegressions } from "./foliate-layout-regressions";
import { runMediaRegressions } from "./foliate-media-regressions";
import { runMOBIRegressions } from "./foliate-mobi-regressions";
import { runPaginatorRegressions } from "./foliate-paginator-regressions";
import { runPDFRegressions } from "./foliate-pdf-regressions";
import { runFitRegressions } from "./foliate-fit-regressions";
import { runZoomRegressions } from "./foliate-zoom-regressions";
import { runFoliateRegressions } from "./foliate-regressions";
import { runScrollChapterRegressions } from "./foliate-scroll-chapter-regressions";
import { runViewRegressions } from "./foliate-view-regressions";
import { runDocumentLayoutRegressions } from "./reader-document-layout-regressions";
import { runCustomTypographyRegressions } from "./reader-custom-typography-regressions";

export type RuntimeResult = { suite: string; name: string; passed: boolean; details?: string };
export type RuntimeReport = { done: boolean; results: RuntimeResult[]; error?: string };

declare global {
  interface Window {
    __runtimeRegressions?: RuntimeReport;
  }
}

const ENGINE_BASE = "/foliate-js/";

/** Import an emitted engine module without letting Vite transform its URL. */
function engine<T>(name: string): Promise<T> {
  const url = new URL(`${ENGINE_BASE}${name}.js`, location.origin).href;
  return import(/* @vite-ignore */ url) as Promise<T>;
}

async function run(report: RuntimeReport): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window))
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  const [cfi, view, paginator, epub, fixed, fb2, pdf, footnotes, media, search, walker, tts, quote] = await Promise.all(
    [
      engine<typeof CFI>("epubcfi"),
      engine<typeof ViewModule>("view"),
      engine<typeof PaginatorModule>("paginator"),
      engine<typeof import("../../foliate-js/src/epub")>("epub"),
      engine<typeof import("../../foliate-js/src/fixed-layout")>("fixed-layout"),
      engine<typeof import("../../foliate-js/src/fb2")>("fb2"),
      engine<typeof import("../../foliate-js/src/pdf")>("pdf"),
      engine<typeof import("../../foliate-js/src/footnotes")>("footnotes"),
      engine<typeof import("../../foliate-js/src/media-overlay")>("media-overlay"),
      engine<typeof import("../../foliate-js/src/search")>("search"),
      engine<typeof import("../../foliate-js/src/text-walker")>("text-walker"),
      engine<typeof import("../../foliate-js/src/tts")>("tts"),
      engine<typeof import("../../foliate-js/src/quote-image")>("quote-image"),
    ],
  );
  const suites: [string, () => Promise<{ name: string; passed: boolean; details?: string }[]>][] = [
    ["foundation", () => runFoliateRegressions(cfi, { search, walker, tts, quote })],
    ["epub", () => runEPUBRegressions({ epub, view })],
    ["layout", () => runLayoutRegressions({ view, fixed, fb2 })],
    ["pdf", () => runPDFRegressions({ pdf, view, fixed })],
    ["zoom", () => runZoomRegressions({ pdf, view, fixed })],
    ["mobi", () => runMOBIRegressions({ view })],
    ["view", () => runViewRegressions({ view, footnotes, media })],
    ["paginator", () => runPaginatorRegressions(paginator.Paginator)],
    ["media", () => runMediaRegressions(paginator.Paginator)],
    ["chapter", () => runChapterRegressions(view.View)],
    ["scroll-chapter", () => runScrollChapterRegressions(view.View)],
    ["document-layout", () => runDocumentLayoutRegressions(view.View)],
    ["custom-typography", () => runCustomTypographyRegressions(paginator.Paginator)],
    ["fit", () => runFitRegressions(view.View)],
  ];
  for (const [suite, execute] of suites) {
    setStatus(`Running ${suite}…`);
    try {
      for (const result of await execute()) publish(report, { suite, ...result });
    } catch (error) {
      publish(report, {
        suite,
        name: "suite completed",
        passed: false,
        details: error instanceof Error ? (error.stack ?? error.message) : String(error),
      });
    }
  }
}

function setStatus(text: string): void {
  const status = document.getElementById("status");
  if (status) status.textContent = text;
}

function publish(report: RuntimeReport, result: RuntimeResult): void {
  report.results.push(result);
  const item = document.createElement("li");
  item.className = result.passed ? "passed" : "failed";
  item.textContent = `${result.passed ? "PASS" : "FAIL"} [${result.suite}] ${result.name}`;
  if (result.details) {
    const details = document.createElement("pre");
    details.textContent = result.details;
    item.append(details);
  }
  document.getElementById("results")?.append(item);
}

const report: RuntimeReport = { done: false, results: [] };
window.__runtimeRegressions = report;
run(report)
  .then(
    () => {
      const failed = report.results.filter((result) => !result.passed).length;
      setStatus(`${report.results.length - failed} passed, ${failed} failed`);
    },
    (error: unknown) => {
      report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
      setStatus(`Harness failed: ${report.error}`);
    },
  )
  .finally(() => {
    report.done = true;
  });
