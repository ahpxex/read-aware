/**
 * ReadAware Evals viewer——本地开发工具 SPA。三个页面（hash 路由，免依赖）：
 *   #/            目录总览：全部套件（S01…）+ 最近 runs
 *   #/suites/:id  套件详情：测什么（描述）、每个场景怎么测（turns/断言/rubric）
 *   #/runs/:id    一次运行的完整报告（大盘、逐场景、逐 run 展开）
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
    <div className="layout">
      <nav className="sidebar">
        <div className="brand">
          <a href="#/">
            ReadAware <span className="accent">Evals</span>
          </a>
        </div>
        <a className={`navitem ${route === "/" ? "active" : ""}`} href="#/">
          <span className="code">◎</span> 总览
        </a>
        {(["behavior", "realbook"] as const).map((group) => (
          <div className="navgroup" key={group}>
            <div className="label">
              {group === "behavior" ? "能力套件" : "真书套件"}
            </div>
            {(catalog ?? [])
              .filter((suite) => suite.group === group)
              .map((suite) => (
                <a
                  key={suite.id}
                  className={`navitem ${activeSuite === suite.id ? "active" : ""}`}
                  href={`#/suites/${suite.id}`}
                >
                  <span className="code">{suite.code}</span>
                  <span>{suite.id}</span>
                </a>
              ))}
          </div>
        ))}
      </nav>
      <main className="content">
        {error && <div className="error">{error}</div>}
        {!catalog || !runs ? (
          <div className="loading">加载套件目录…</div>
        ) : runMatch ? (
          <RunPage runId={runMatch[1]!} catalog={catalog} tick={tick} />
        ) : suiteMatch ? (
          <SuitePage suiteId={suiteMatch[1]!} catalog={catalog} runs={runs} />
        ) : (
          <CatalogPage catalog={catalog} runs={runs} tick={tick} />
        )}
      </main>
    </div>
  );
}
