import { expect, test } from 'bun:test';
import { attachTocFractions } from './toc-fractions';
import type { FoliateView } from './foliate-engine';
import type { TocEntry } from './reader-types';

test('chapter marks await asynchronous EPUB, KF8 and PDF navigation without changing unresolved entries', async () => {
  const entries: TocEntry[] = ['epub', 'kf8', 'pdf', 'missing'].map((href, spineIndex) => ({
    id: href, href, label: href, depth: 0, spineIndex,
  }));
  const view: Pick<FoliateView, 'getSectionFractions' | 'resolveNavigation'> = {
    getSectionFractions: () => [0, 0.2, 0.6, 1],
    resolveNavigation: async target => {
      const index = ['epub', 'kf8', 'pdf'].indexOf(String(target));
      return index < 0 ? undefined : { index };
    },
  };
  const mapped = await attachTocFractions(view, entries);
  expect(mapped.map(entry => entry.fraction)).toEqual([0, 0.2, 0.6, undefined]);
  expect(entries.every(entry => entry.fraction === undefined)).toBe(true);
});
