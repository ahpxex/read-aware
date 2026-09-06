import type { FoliateView } from "./foliate-engine";
import type { TocEntry } from "./reader-types";
import { createLogger } from "../../../platform/logger";

const log = createLogger("toc-fractions");
type NavigationView = Pick<FoliateView, "getSectionFractions" | "resolveNavigation">;

/** Resolve chapter marks off the first-page critical path, including PDF/KF8 hrefs. */
export async function attachTocFractions(view: NavigationView, entries: TocEntry[]): Promise<TocEntry[]> {
  const fractions = view.getSectionFractions();
  if (!fractions.length) return entries;
  return Promise.all(entries.map(async entry => {
    try {
      const target = await view.resolveNavigation(entry.href);
      const fraction = target ? fractions[target.index] : undefined;
      return typeof fraction === "number" ? { ...entry, fraction } : entry;
    } catch (error) {
      log.warn("Could not resolve chapter mark", error);
      return entry;
    }
  }));
}
