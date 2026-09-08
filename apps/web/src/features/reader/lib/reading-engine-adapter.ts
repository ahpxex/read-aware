import { AppError, type ReadingLocation } from "@read-aware/core";
import { readingRuntime } from "../../../domain/reading-runtime";
import type { FoliateView } from "./foliate-engine";

export async function waitForReadingPaint(view: FoliateView): Promise<void> {
  const renderer = view.renderer;
  if (renderer && "waitForCurrentRender" in renderer) {
    try { await renderer.waitForCurrentRender(); }
    catch (error) { throw new AppError("reader/render-failed", "Reader page could not finish rendering", { cause: error }); }
  }
}

/** The only renderer-specific part of the public reading-session controller. */
export function attachReadingEngine(view: FoliateView, sessionId: string, bookId: string, contentVersion: string): () => void {
  const location = (): ReadingLocation => {
    const position = view.lastLocation;
    if (!position) throw new AppError("reader/unavailable", "Renderer has not reported its first position");
    return {
      bookId, contentVersion,
      ...(position.cfi ? { cfi: position.cfi } : {}),
      ...(position.tocItem?.href ? { href: position.tocItem.href } : {}),
      ...(Number.isFinite(position.fraction) ? { fraction: position.fraction } : {}),
    };
  };
  const publish = () => readingRuntime.relocate(sessionId, location(), view.lastLocation?.range?.toString() ?? "");
  const detach = readingRuntime.attach(sessionId, {
    navigate: async target => {
      const resolved = await view.goTo(target.cfi ?? target.href ?? { fraction: target.fraction! });
      if (!resolved) throw new AppError("reader/target-not-found", "Renderer could not resolve this target");
      await waitForReadingPaint(view);
      return location();
    },
    step: async direction => {
      if (direction === "next") await view.next(); else await view.prev();
      await waitForReadingPaint(view);
      return location();
    },
  }, location());
  view.addEventListener("relocate", publish);
  publish();
  return () => { view.removeEventListener("relocate", publish); detach(); };
}
