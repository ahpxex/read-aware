import type { FoliateBook } from './foliate-engine';

type Lifetime = { references: number; closed: boolean };
const lifetimes = new WeakMap<FoliateBook, Lifetime>();

/** Reader and background extraction share a parser; only the final owner closes it. */
export function retainBook(book: FoliateBook): () => Promise<void> {
  let lifetime = lifetimes.get(book);
  if (!lifetime) {
    lifetime = { references: 0, closed: false };
    lifetimes.set(book, lifetime);
  }
  if (lifetime.closed) throw new Error('Cannot retain a closed book');
  lifetime.references++;
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    if (--lifetime.references === 0) {
      lifetime.closed = true;
      await book.destroy?.();
    }
  };
}
