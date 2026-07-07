/**
 * Idle-time warmup for the lazily-split surfaces (see App.tsx).
 *
 * The shelf renders from a lean critical chunk; everything else is fetched
 * once the main thread goes idle, so by the time a human clicks a book or
 * opens a panel the code is already warm and the Suspense fallbacks never
 * show. `import()` de-dupes against React.lazy's own imports (same modules),
 * and a failed prefetch is harmless — the real render retries the import.
 *
 * Two stages by likely-next-click: the Context page first (it drags the whole
 * chat stack — ChatTranscript → Streamdown → shiki — and is one click away
 * from boot), then the reader engine and the rest on a follow-up idle slot so
 * their evaluation doesn't stall the context stack's.
 */
function onIdle(work: () => void, timeout: number): void {
  // WKWebView has no requestIdleCallback — fall back to a short timeout that
  // lands well after first paint and the initial library load.
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(work, { timeout });
  } else {
    window.setTimeout(work, Math.min(timeout, 1500));
  }
}

export function scheduleIdleWarmup(): void {
  onIdle(() => {
    void import("./features/context/components/ContextWorkspace");
    void import("./features/context/components/ThreadsPopover");
    void import("./features/context/components/AnnotationsPopover");

    onIdle(() => {
      void import("./features/reader/components/ReaderWorkspace");
      void import("./features/stats/components/StatsWorkspace");
      void import("./features/settings/SettingsDialog");
      void import("./features/reader/lib/foliate-engine").then((engine) => {
        engine.preloadFoliateEngine();
      });
    }, 4000);
  }, 2000);
}
