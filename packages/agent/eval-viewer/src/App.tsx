/**
 * ReadAware Evals viewer——本地开发工具 SPA。三个页面（hash 路由，免依赖）：
 *   #/            目录总览：全部套件（S01…）+ 最近 runs
 *   #/suites/:id  套件评测：最近运行的问题、回答和逐条人工评分
 *   #/runs/:id    一次运行的固定评测链接（同一套逐条人工 review 流）
 * 场景引用坐标 = 套件编号.场景序号（如 S07.3）——反馈时报这个号。
 */
import { useEffect, useState } from "react";
import { fetchCatalog, fetchRuns, subscribeRunEvents, type CatalogSuite, type RunListing } from "./api";
import { CatalogPage } from "./pages/CatalogPage";
import { RunPage } from "./pages/RunPage";
import { SuitePage } from "./pages/SuitePage";

function useHashRoute(): string {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash.replace(/^#/, "") || "/";
}

export function App() {
  const route = useHashRoute();
  const [catalog, setCatalog] = useState<CatalogSuite[] | null>(null);
  const [runs, setRuns] = useState<RunListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 工件目录的写入直播：eval 跑动时 tick 递增，依赖它的取数自动重拉。
  const [tick, setTick] = useState(0);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [route]);

  useEffect(() => {
    fetchCatalog().then(setCatalog).catch((cause) => setError(String(cause)));
    return subscribeRunEvents(() => setTick((value) => value + 1));
  }, []);

  useEffect(() => {
    fetchRuns().then(setRuns).catch((cause) => setError(String(cause)));
  }, [tick]);

  const suiteMatch = route.match(/^\/suites\/([^/]+)$/);
  const runMatch = route.match(/^\/runs\/([^/]+)$/);
  const activeSuite = suiteMatch?.[1];

  return (
    <div className="flex min-h-full max-md:block">
      <nav className="sticky top-0 h-screen w-[248px] shrink-0 overflow-x-hidden overflow-y-auto border-r border-[var(--border)] px-3 pt-5 pb-8 max-md:static max-md:flex max-md:h-auto max-md:w-full max-md:items-center max-md:gap-1 max-md:overflow-x-auto max-md:overflow-y-hidden max-md:border-r-0 max-md:border-b max-md:p-2.5">
        <div className="px-2.5 pt-1 pb-3.5 text-[15px] font-semibold whitespace-nowrap max-md:pr-4 max-md:pb-1">
          <a href="#/">
            ReadAware <span className="text-[var(--accent)]">Evals</span>
          </a>
        </div>
        <a
          className={`flex items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-[13px] whitespace-nowrap transition-colors hover:bg-[var(--surface)] hover:text-[var(--fg)] ${
            route === "/"
              ? "bg-[var(--accent-bg)] text-[var(--accent)]"
              : "text-[var(--muted)]"
          }`}
          href="#/"
        >
          <span className={`w-[30px] shrink-0 font-mono text-[11px] max-md:hidden ${route === "/" ? "text-[var(--accent)]" : "text-[var(--subtle)]"}`}>
            ◎
          </span>{" "}
          总览
        </a>
        {(["behavior", "realbook"] as const).map((group) => (
          <div className="mt-4 max-md:contents" key={group}>
            <div className="px-2.5 pb-1.5 text-[11px] uppercase tracking-[0.05em] text-[var(--subtle)] max-md:hidden">
              {group === "behavior" ? "能力套件" : "真书套件"}
            </div>
            {(catalog ?? [])
              .filter((suite) => suite.group === group)
              .map((suite) => (
                <a
                  key={suite.id}
                  className={`flex items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-[13px] whitespace-nowrap transition-colors hover:bg-[var(--surface)] hover:text-[var(--fg)] ${
                    activeSuite === suite.id
                      ? "bg-[var(--accent-bg)] text-[var(--accent)]"
                      : "text-[var(--muted)]"
                  }`}
                  href={`#/suites/${suite.id}`}
                  title={suite.id}
                >
                  <span className={`w-[30px] shrink-0 font-mono text-[11px] ${activeSuite === suite.id ? "text-[var(--accent)]" : "text-[var(--subtle)]"}`}>
                    {suite.code}
                  </span>
                  <span>{suite.displayName}</span>
                </a>
              ))}
          </div>
        ))}
      </nav>
      <main className="min-w-0 flex-1 px-12 pt-11 pb-24 max-lg:px-7 max-md:px-3.5 max-md:pt-6 max-md:pb-16">
        {error && <div className="py-6 text-[var(--fail)]">{error}</div>}
        {!catalog || !runs ? (
          <div className="py-12 text-[var(--subtle)]">加载套件目录…</div>
        ) : runMatch ? (
          <RunPage runId={runMatch[1]!} catalog={catalog} tick={tick} />
        ) : suiteMatch ? (
          <SuitePage suiteId={suiteMatch[1]!} catalog={catalog} runs={runs} tick={tick} />
        ) : (
          <CatalogPage catalog={catalog} runs={runs} tick={tick} />
        )}
      </main>
    </div>
  );
}
