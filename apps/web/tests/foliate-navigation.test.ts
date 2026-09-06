import { expect, test } from 'bun:test';
import { History } from '../foliate-js/src/history';
import { anchorElement, anchorRange, eventElement, languageInfo } from '../foliate-js/src/navigation';
import { searchBook } from '../foliate-js/src/book-search';
import { getFileEntries } from '../foliate-js/src/book-loader';
import type { Book } from '../foliate-js/src/book';
import { withDom } from './helpers/foliate-dom';

test('history deduplicates fraction zero, replaces its initial state and truncates forward entries', () => {
  const history = new History();
  history.replaceState({ fraction: 0 });
  history.pushState({ fraction: 0 });
  expect(history.canGoBack).toBe(false);
  history.pushState(1);
  history.pushState(2);
  history.back();
  expect(history.canGoForward).toBe(true);
  history.pushState(3);
  expect(history.canGoForward).toBe(false);
  history.clear();
  expect(history.canGoBack).toBe(false);
  expect(history.canGoForward).toBe(false);
});

test('navigation helpers accept iframe-realm nodes, text targets and Korean metadata', () => withDom(() => {
  document.body.innerHTML = '<a><span>note</span></a>';
  const span = document.querySelector('span')!;
  const range = anchorRange(document, span)!;
  expect(range.toString()).toBe('note');
  expect(anchorElement(range)).toBe(span);
  expect(eventElement(span.firstChild)).toBe(span);
  expect(anchorRange(document, 0)).toBeNull();
  expect(languageInfo(['ko-KR']).isCJK).toBe(true);
  expect(languageInfo([])).toEqual({});
}));

test('search preserves section CFIs, progress and cooperative cancellation', () => withDom(async () => {
  const book: Book = { sections: [0, 1].map(index => ({ id: index, size: 20, load: () => '',
    createDocument: () => new DOMParser().parseFromString('<p>One needle two needle</p>', 'text/html'),
  })) };
  const all = [];
  for await (const item of searchBook(book, 'needle', undefined, {}, (index, range) => `${index}:${range}`, new AbortController().signal)) all.push(item);
  expect(all).toHaveLength(4);
  expect(all.at(-1)).toEqual({ progress: 1 });
  const controller = new AbortController();
  const iter = searchBook(book, 'needle', 0, {}, (index, range) => `${index}:${range}`, controller.signal);
  expect((await iter.next()).value).toMatchObject({ cfi: '0:needle' });
  controller.abort();
  expect((await iter.next()).done).toBe(true);
}));

test('directory loading drains every batch and nested directory', async () => {
  const fileEntry = (name: string): FileSystemFileEntry => ({
    name, fullPath: `/root/${name}`, isFile: true, isDirectory: false,
    filesystem: { name: 'fixture', root: directory },
    getParent: callback => callback?.(directory),
    file: callback => callback(new File(['x'], name)),
  });
  const directory: FileSystemDirectoryEntry = {
    name: 'root', fullPath: '/root', isFile: false, isDirectory: true,
    get filesystem() { return { name: 'fixture', root: directory }; },
    getParent: callback => callback?.(directory),
    getDirectory: () => { throw new Error('Not used'); },
    getFile: () => { throw new Error('Not used'); },
    createReader: () => {
      const batches = [[fileEntry('a')], [fileEntry('b')], []];
      return { readEntries: callback => callback(batches.shift() ?? []) };
    },
  };
  expect((await getFileEntries(directory)).map(entry => entry.name)).toEqual(['a', 'b']);
});
