/**
 * The library feature's public surface for other features (see the
 * `features-via-public-index` dependency rule). Only what another feature
 * legitimately shares is exported here.
 */

// Plugins open book images through the same reader as the in-app lightbox.
export { readBookImage } from "./lib/book-images";
// The reader leases a book's prepared content like every other consumer.
export { acquireBookContent, BookSourceMissingError } from "./lib/book-content-source";
export type { BookContent, BookContentLease } from "./lib/book-content-source";
