import { expect, test } from "bun:test";
import { AppError, type ReadingLocation } from "@read-aware/core";
import { ReadingSessionController, type ReadingEngineAdapter } from "../../../domain/reading-session-controller";
import type { FoliateLinkDetail } from "./foliate-engine";
import { createNativeLinkNavigator } from "./native-link-navigation";

const location = (cfi: string): ReadingLocation => ({ bookId: "book", contentVersion: "v1", cfi });
const link = (href: string) => new CustomEvent<FoliateLinkDetail>("link", { cancelable: true, detail: { href, a: {} as Element } });
function fixture() {
  const runtime = new ReadingSessionController(() => {}, 1000), calls: unknown[] = [], errors: unknown[] = [];
  const sessionId = runtime.begin("book");
  const engine: ReadingEngineAdapter = { navigate: async target => {
    calls.push(target); return location(target.cfi ?? target.href ?? "start");
  }, step: async direction => location(direction) };
  const detach = runtime.attach(sessionId, engine, location("start"));
  const navigator = createNativeLinkNavigator(runtime, { sessionId, bookId: "book", contentVersion: "v1" }, error => errors.push(error));
  return { runtime, engine, calls, errors, navigator, close: () => { navigator.dispose(); detach(); } };
}

test("ordinary native links enter the same back/forward history and claimed previews do not", async () => {
  const f = fixture();
  try {
    const preview = link("footnote.xhtml#note"); preview.preventDefault();
    await f.navigator.handle(preview); expect(f.calls).toEqual([]);
    expect(f.runtime.snapshot().history.canGoBack).toBe(false);
    const event = link("chapter.xhtml#two"); const pending = f.navigator.handle(event);
    expect(event.defaultPrevented).toBe(true); await pending;
    expect(f.calls[0]).toMatchObject({ bookId: "book", contentVersion: "v1", href: "chapter.xhtml#two" });
    expect(f.runtime.snapshot().history.canGoBack).toBe(true);
    expect((await f.runtime.back()).location.cfi).toBe("start");
    expect((await f.runtime.forward()).location.cfi).toBe("chapter.xhtml#two");
    await f.runtime.back(); await f.navigator.handle(link("chapter.xhtml#three"));
    expect(f.runtime.snapshot().history.canGoForward).toBe(false); expect(f.errors).toEqual([]);
  } finally { f.close(); }
});

test("native failures preserve history and surface an error instead of falling back to private navigation", async () => {
  const f = fixture();
  try {
    const error = new AppError("reader/target-not-found", "missing target");
    f.engine.navigate = async () => { throw error; };
    const event = link("missing"); await f.navigator.handle(event);
    expect(event.defaultPrevented).toBe(true); expect(f.errors).toEqual([error]);
    expect(f.runtime.snapshot().history.canGoBack).toBe(false);
    expect(f.runtime.snapshot().location?.cfi).toBe("start");
  } finally { f.close(); }
});

test("retiring a view cancels its pending link and stale clicks cannot reopen the previous book", async () => {
  const f = fixture(), started = Promise.withResolvers<void>(), finished = Promise.withResolvers<ReadingLocation>();
  try {
    f.engine.navigate = async () => { started.resolve(); return finished.promise; };
    const pending = f.navigator.handle(link("delayed")); await started.promise;
    f.navigator.dispose(); await pending;
    finished.resolve(location("late")); await Promise.resolve(); await Promise.resolve();
    expect(f.errors).toEqual([]); expect(f.runtime.snapshot().history.canGoBack).toBe(false);
    f.runtime.begin("other-book");
    const stale = link("old-book"); await f.navigator.handle(stale);
    expect(stale.defaultPrevented).toBe(true); expect(f.runtime.snapshot().bookId).toBe("other-book");
  } finally { finished.resolve(location("late")); f.close(); }
});

test("new native or public navigation supersedes a pending link without showing an obsolete failure", async () => {
  for (const source of ["native", "public"] as const) {
    const f = fixture(), started = Promise.withResolvers<void>(), finished = Promise.withResolvers<ReadingLocation>();
    try {
      f.engine.navigate = async target => {
        if (target.href === "first") { started.resolve(); return finished.promise; }
        return location(target.href ?? "second");
      };
      const first = f.navigator.handle(link("first")); await started.promise;
      const second = source === "native" ? f.navigator.handle(link("second")) : f.runtime.navigate({ href: "second" });
      await first; finished.resolve(location("late-first")); await second;
      expect(f.errors).toEqual([]); expect(f.runtime.snapshot().location?.cfi).toBe("second");
    } finally { finished.resolve(location("late-first")); f.close(); }
  }
});
