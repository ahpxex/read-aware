/**
 * Idle-time warmup for the lazily-split surfaces (see App.tsx).
 *
 * The shelf renders from a lean critical chunk; the reader, context, stats,
 * and settings chunks — plus the vendored foliate engine — are fetched once
 * the main thread goes idle, so by the time a human clicks a book or opens a
 * panel the code is already warm and the Suspense fallbacks never show.
 * `import()` de-dupes against React.lazy's own imports (same modules), and a
 * failed prefetch is harmless — the real render retries the import.
 */
export function scheduleIdleWarmup(): void {
  const warm = () => {
    void import("./features/reader/components/ReaderWorkspace");
    void import("./features/context/components/ContextWorkspace");
    void import("./features/stats/components/StatsWorkspace");
    void import("./features/settings/SettingsDialog");
    void import("./features/reader/lib/foliate-engine").then((engine) => {
      engine.preloadFoliateEngine();
    });
  };

  // WKWebView has no requestIdleCallback — fall back to a short timeout that
  // lands well after first paint and the initial library load.
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(warm, { timeout: 3000 });
  } else {
    window.setTimeout(warm, 1500);
  }
}
