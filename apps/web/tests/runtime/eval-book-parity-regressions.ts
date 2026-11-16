/**
 * The eval books, extracted in a browser engine.
 *
 * Agent evals read their books through the app's code over a headless shell
 * (tests/headless), where the DOM is jsdom. A book's snapshot — what scenarios
 * are written against — is produced there. This suite parses and extracts the
 * same files with the emitted engine in a real browser and requires the same
 * chapters, titles, text and reading coordinates, so that what the headless
 * host calls "the book as the app reads it" is what a webview reads too.
 */
import type * as ViewModule from "../../foliate-js/src/view";
import { buildChapterMap } from "../../foliate-js/src/chapter-map";
import { extractBookText } from "../../src/features/library/lib/book-text-extraction";
import type { FoliateBook } from "../../src/features/reader/lib/foliate-engine";
import { ensureUsableToc } from "../../src/features/reader/lib/toc-synthesis";

type Result = { name: string; passed: boolean; details?: string };
type SnapshotChapter = { title?: string; text: string; hrefs?: string[]; layout: unknown };

const fixtures = "../../../../packages/agent/fixtures";
const files = import.meta.glob("../../../../packages/agent/fixtures/*.epub", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;
const snapshots = import.meta.glob("../../../../packages/agent/fixtures/*.booktext.json", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

export async function runEvalBookParityRegressions({ view }: { view: typeof ViewModule }): Promise<Result[]> {
  const results: Result[] = [];
  const slugs = Object.keys(snapshots).map((path) => path.slice(fixtures.length + 1, -".booktext.json".length));
  if (!slugs.length) return [{ name: "eval books have snapshots", passed: false, details: "no snapshot found" }];
  for (const slug of slugs.sort()) {
    const name = `${slug}: a browser extracts the chapters, text and coordinates of the snapshot`;
    try {
      const [bytes, stored] = await Promise.all([
        fetch(files[`${fixtures}/${slug}.epub`]!).then((response) => response.blob()),
        fetch(snapshots[`${fixtures}/${slug}.booktext.json`]!).then((response) => response.json()),
      ]);
      const book = (await view.makeBook(
        new File([bytes], `${slug}.epub`, { type: "application/epub+zip" }),
      )) as FoliateBook;
      await ensureUsableToc(book);
      const record = await extractBookText(book, {
        bookId: slug,
        contentVersion: stored.contentVersion,
        prior: null,
        chapters: await buildChapterMap(book),
        signal: new AbortController().signal,
        yieldToReader: async () => {},
        save: async () => {},
        progress: () => {},
        warn: () => {},
      });
      const extracted: SnapshotChapter[] = record.chapters.map(({ title, text, hrefs, layout }) => ({
        ...(title === undefined ? {} : { title }),
        text,
        ...(hrefs ? { hrefs } : {}),
        layout,
      }));
      const expected = stored.chapters as SnapshotChapter[];
      const differs = (index: number) => JSON.stringify(extracted[index]) !== JSON.stringify(expected[index]);
      const first = Array.from({ length: Math.max(extracted.length, expected.length) }, (_, index) => index).find(
        differs,
      );
      if (first === undefined) {
        results.push({ name, passed: true });
        continue;
      }
      const [mine, theirs] = [extracted[first], expected[first]];
      const field = (["title", "text", "hrefs", "layout"] as const).find(
        (key) => JSON.stringify(mine?.[key]) !== JSON.stringify(theirs?.[key]),
      );
      results.push({
        name,
        passed: false,
        details: `${extracted.length} chapters here, ${expected.length} in the snapshot; chapter ${first} differs in ${field}:\n  browser:  ${JSON.stringify(mine?.[field ?? "title"])?.slice(0, 300)}\n  snapshot: ${JSON.stringify(theirs?.[field ?? "title"])?.slice(0, 300)}`,
      });
    } catch (error) {
      results.push({
        name,
        passed: false,
        details: error instanceof Error ? (error.stack ?? error.message) : String(error),
      });
    }
  }
  return results;
}
