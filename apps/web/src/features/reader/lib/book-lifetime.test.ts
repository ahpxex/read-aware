import { expect, test } from 'bun:test';
import { retainBook } from './book-lifetime';
import type { FoliateBook } from './foliate-engine';

test('parsed books live until reader and background owners have both released them', async () => {
  let destroyed = 0;
  const book: FoliateBook = { sections: [], destroy: async () => { destroyed++; } };
  const reader = retainBook(book), background = retainBook(book);
  await reader();
  await reader();
  expect(destroyed).toBe(0);
  await background();
  expect(destroyed).toBe(1);
  expect(() => retainBook(book)).toThrow('closed');
});

test('a failing destroy is surfaced and not called again', async () => {
  let destroyed = 0;
  const book: FoliateBook = { sections: [], destroy: async () => { destroyed++; throw new Error('close failed'); } };
  const release = retainBook(book);
  await expect(release()).rejects.toThrow('close failed');
  await release();
  expect(destroyed).toBe(1);
});
